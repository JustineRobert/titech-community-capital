'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/ChartExportButton.jsx
 *
 * Purpose:
 *   Enterprise-grade chart/data export control for TITech analytics screens.
 *
 * Responsibilities:
 *   - Export chart data as CSV.
 *   - Export chart data as JSON.
 *   - Export rendered SVG charts as SVG.
 *   - Export rendered chart SVGs as PNG.
 *   - Support browser print as a presentation/export workflow.
 *   - Provide accessible keyboard/mouse interaction.
 *   - Provide optional single-action or dropdown export UX.
 *   - Normalize common data shapes.
 *   - Sanitize filenames.
 *   - Protect CSV exports against spreadsheet formula injection.
 *   - Provide explicit export lifecycle callbacks.
 *
 * Financial integrity:
 *   - Presentation/export only.
 *   - Does not mutate transactions, balances, journals or ledger state.
 *   - Does not calculate settlement.
 *   - Does not transform pending, queued, offline or provider-accepted states
 *     into settled financial states.
 *   - Server-authoritative financial values remain authoritative.
 *   - JSON preserves normalized values as supplied to this presentation layer.
 *
 * Browser support:
 *   - Modern browsers with Blob, URL.createObjectURL and download support.
 *   - SVG/PNG export requires the target chart DOM to expose an SVG element.
 *
 * Typical usage:
 *
 *   const chartRef = useRef(null);
 *
 *   <div ref={chartRef}>
 *     <CashFlowChart data={cashFlowData} />
 *   </div>
 *
 *   <ChartExportButton
 *     data={cashFlowData}
 *     chartRef={chartRef}
 *     filename="titech-cash-flow"
 *   />
 *
 * Supported formats:
 *   - csv
 *   - json
 *   - svg
 *   - png
 *   - print
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

/* ============================================================================
 * Constants
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechChartExportButton';

const DEFAULT_FILENAME =
  'titech-chart-export';

const DEFAULT_CSV_EXTENSION = 'csv';

const DEFAULT_JSON_EXTENSION = 'json';

const DEFAULT_SVG_EXTENSION = 'svg';

const DEFAULT_PNG_EXTENSION = 'png';

const DEFAULT_EXPORT_PADDING = 24;

const DEFAULT_PNG_SCALE = 2;

const DEFAULT_MAX_FILENAME_LENGTH = 120;

const DEFAULT_MENU_LABEL =
  'Export chart and data';

const DEFAULT_BUTTON_LABEL =
  'Export';

const DEFAULT_LOADING_LABEL =
  'Exporting…';

const DEFAULT_SUCCESS_DURATION = 2200;

const DEFAULT_DATASET_NAME =
  'TITech Chart Data';

/* ============================================================================
 * Generic helpers
 * ========================================================================== */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function classNames(...values) {
  return values
    .flat(Infinity)
    .filter(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0,
    )
    .join(' ');
}

function getErrorMessage(
  error,
  fallback =
    'The export could not be completed.',
) {
  if (typeof error === 'string') {
    return error;
  }

  if (
    error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return fallback;
}

/**
 * Converts a DOM ref-like value into an actual Element.
 *
 * Supports:
 *   - RefObject
 *   - callback-returning wrappers used by some abstractions
 *   - direct HTMLElement/SVGElement
 */
function resolveElement(refOrElement) {
  if (!refOrElement) {
    return null;
  }

  if (
    typeof Element !== 'undefined' &&
    refOrElement instanceof Element
  ) {
    return refOrElement;
  }

  if (
    isObject(refOrElement) &&
    'current' in refOrElement
  ) {
    const current = refOrElement.current;

    if (
      typeof Element !== 'undefined' &&
      current instanceof Element
    ) {
      return current;
    }
  }

  return null;
}

/**
 * Produces a filesystem-safe filename.
 */
function sanitizeFilename(
  filename,
  fallback = DEFAULT_FILENAME,
) {
  const source =
    typeof filename === 'string' &&
    filename.trim()
      ? filename.trim()
      : fallback;

  const withoutExtension = source.replace(
    /\.[A-Za-z0-9]{1,8}$/,
    '',
  );

  const normalized = withoutExtension
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[<>:"/\\|?*\x80-\x9f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .replace(
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i,
      '$1-export',
    )
    .slice(0, DEFAULT_MAX_FILENAME_LENGTH)
    .replace(/[-.]+$/, '');

  return normalized || fallback;
}

/**
 * Ensures the exported filename has one extension and does not create
 * filenames such as `report.csv.csv`.
 */
function withExtension(
  filename,
  extension,
) {
  const safeName = sanitizeFilename(filename);

  const normalizedExtension =
    String(extension || '')
      .replace(/^\./, '')
      .toLowerCase();

  if (!normalizedExtension) {
    return safeName;
  }

  const suffix =
    `.${normalizedExtension}`;

  if (
    safeName.toLowerCase().endsWith(suffix)
  ) {
    return safeName;
  }

  return `${safeName}${suffix}`;
}

/* ============================================================================
 * Data normalization
 * ========================================================================== */

function extractArray(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!isObject(data)) {
    return [];
  }

  const candidates = [
    data.data,
    data.items,
    data.results,
    data.rows,
    data.records,
    data.series,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

/**
 * Converts nested values into a deterministic export-friendly shape.
 *
 * Undefined properties are removed.
 * Dates are represented as ISO strings.
 */
function normalizeExportValue(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString();
  }

  if (
    typeof value === 'object' &&
    '$numberDecimal' in value
  ) {
    return String(value.$numberDecimal);
  }

  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return String(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeExportValue(
        item,
        seen,
      ),
    );
  }

  const output = {};

  Object.keys(value)
    .sort()
    .forEach((key) => {
      const child = value[key];

      if (child === undefined) {
        return;
      }

      output[key] =
        normalizeExportValue(
          child,
          seen,
        );
    });

  return output;
}

/**
 * Normalizes rows without imposing a domain-specific schema.
 */
function normalizeRows(data) {
  return extractArray(data).map(
    (row, index) => {
      if (
        row !== null &&
        typeof row === 'object' &&
        !Array.isArray(row)
      ) {
        return {
          ...normalizeExportValue(row),
        };
      }

      return {
        index,
        value:
          normalizeExportValue(row),
      };
    },
  );
}

/**
 * Flattens object fields to a CSV-friendly scalar representation.
 *
 * Nested structures use JSON representation rather than dropping data.
 */
function csvScalar(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (
    typeof value === 'string'
  ) {
    return value;
  }

  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return JSON.stringify(
    normalizeExportValue(value),
  );
}

/**
 * Protects spreadsheet applications from CSV formula injection.
 *
 * Values beginning with =, +, -, or @ may otherwise be interpreted as
 * formulas by spreadsheet software.
 *
 * A leading apostrophe preserves the visible value while preventing formula
 * evaluation when opened in common spreadsheet applications.
 */
function protectCsvFormula(value) {
  const stringValue = String(
    value ?? '',
  );

  if (
    /^[=+\-@]/.test(
      stringValue.trimStart(),
    )
  ) {
    return `'${stringValue}`;
  }

  return stringValue;
}

function escapeCsvCell(value) {
  const protectedValue =
    protectCsvFormula(
      csvScalar(value),
    );

  if (
    /["\n,\r]/.test(
      protectedValue,
    )
  ) {
    return `"${protectedValue.replace(
      /"/g,
      '""',
    )}"`;
  }

  return protectedValue;
}

function collectColumnKeys(rows) {
  const keys = new Set();

  rows.forEach((row) => {
    if (
      row &&
      typeof row === 'object' &&
      !Array.isArray(row)
    ) {
      Object.keys(row).forEach((key) =>
        keys.add(key),
      );
    }
  });

  return Array.from(keys);
}

/* ============================================================================
 * CSV generation
 * ========================================================================== */

function buildCsv(
  rows,
  {
    includeBom = true,
    lineEnding = '\r\n',
  } = {},
) {
  const normalizedRows = normalizeRows(rows);

  const columns =
    collectColumnKeys(
      normalizedRows,
    );

  if (columns.length === 0) {
    const emptyCsv =
      'index,value';

    return includeBom
      ? `\uFEFF${emptyCsv}`
      : emptyCsv;
  }

  const header = columns
    .map(escapeCsvCell)
    .join(',');

  const body =
    normalizedRows
      .map((row) =>
        columns
          .map((column) =>
            escapeCsvCell(
              row?.[column],
            ),
          )
          .join(','),
      )
      .join(lineEnding);

  const csv = body
    ? `${header}${lineEnding}${body}`
    : header;

  return includeBom
    ? `\uFEFF${csv}`
    : csv;
}

/* ============================================================================
 * JSON generation
 * ========================================================================== */

function buildJson(
  data,
  {
    pretty = true,
  } = {},
) {
  const normalized =
    normalizeRows(data);

  return JSON.stringify(
    normalized,
    null,
    pretty ? 2 : 0,
  );
}

/* ============================================================================
 * Browser download
 * ========================================================================== */

function downloadBlob(
  blob,
  filename,
) {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined'
  ) {
    throw new Error(
      'Browser download APIs are unavailable.',
    );
  }

  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !==
      'function'
  ) {
    throw new Error(
      'The browser does not support downloadable object URLs.',
    );
  }

  const objectUrl =
    URL.createObjectURL(blob);

  try {
    const anchor =
      document.createElement('a');

    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(
      () =>
        URL.revokeObjectURL(
          objectUrl,
        ),
      0,
    );
  }
}

function downloadText(
  content,
  filename,
  mimeType,
) {
  const blob = new Blob(
    [content],
    {
      type: mimeType,
    },
  );

  downloadBlob(
    blob,
    filename,
  );
}

/* ============================================================================
 * SVG handling
 * ========================================================================== */

function findSvgElement(
  target,
) {
  const element =
    resolveElement(target);

  if (!element) {
    return null;
  }

  if (
    typeof SVGSVGElement !==
      'undefined' &&
    element instanceof SVGSVGElement
  ) {
    return element;
  }

  return element.querySelector(
    'svg',
  );
}

function getSvgDimensions(svg) {
  const viewBox =
    svg.viewBox?.baseVal;

  if (
    viewBox &&
    viewBox.width > 0 &&
    viewBox.height > 0
  ) {
    return {
      width: viewBox.width,
      height: viewBox.height,
    };
  }

  const width = Number.parseFloat(
    svg.getAttribute('width') ||
      '0',
  );

  const height = Number.parseFloat(
    svg.getAttribute('height') ||
      '0',
  );

  if (
    width > 0 &&
    height > 0
  ) {
    return {
      width,
      height,
    };
  }

  const bounding =
    svg.getBoundingClientRect();

  return {
    width:
      bounding.width || 1200,
    height:
      bounding.height || 600,
  };
}

function serializeSvg(
  sourceSvg,
  {
    backgroundColor = null,
    padding = DEFAULT_EXPORT_PADDING,
  } = {},
) {
  if (!sourceSvg) {
    throw new Error(
      'No SVG chart element was found.',
    );
  }

  const clone =
    sourceSvg.cloneNode(true);

  const {
    width,
    height,
  } =
    getSvgDimensions(
      sourceSvg,
    );

  const totalWidth =
    width + padding * 2;

  const totalHeight =
    height + padding * 2;

  clone.setAttribute(
    'xmlns',
    'http://www.w3.org/2000/svg',
  );

  clone.setAttribute(
    'xmlns:xlink',
    'http://www.w3.org/1999/xlink',
  );

  clone.setAttribute(
    'width',
    String(totalWidth),
  );

  clone.setAttribute(
    'height',
    String(totalHeight),
  );

  clone.setAttribute(
    'viewBox',
    `0 0 ${totalWidth} ${totalHeight}`,
  );

  /**
   * Recharts and application CSS commonly use CSS variables and CSS classes.
   * A standalone SVG cannot always resolve the original stylesheet, so copy
   * the document's stylesheet rules where browser access permits it.
   */
  let stylesheetText = '';

  if (
    typeof document !==
    'undefined'
  ) {
    try {
      const styles = Array.from(
        document.styleSheets,
      );

      for (const sheet of styles) {
        try {
          const rules =
            Array.from(
              sheet.cssRules || [],
            );

          stylesheetText +=
            rules
              .map((rule) =>
                rule.cssText,
              )
              .join('\n');
        } catch {
          // Cross-origin stylesheets may reject cssRules access.
        }
      }
    } catch {
      // Continue with inline SVG content.
    }
  }

  if (stylesheetText) {
    const styleNode =
      document.createElementNS(
        'http://www.w3.org/2000/svg',
        'style',
      );

    styleNode.setAttribute(
      'type',
      'text/css',
    );

    styleNode.textContent =
      stylesheetText;

    clone.insertBefore(
      styleNode,
      clone.firstChild,
    );
  }

  if (backgroundColor) {
    const backgroundRect =
      document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect',
      );

    backgroundRect.setAttribute(
      'x',
      '0',
    );

    backgroundRect.setAttribute(
      'y',
      '0',
    );

    backgroundRect.setAttribute(
      'width',
      '100%',
    );

    backgroundRect.setAttribute(
      'height',
      '100%',
    );

    backgroundRect.setAttribute(
      'fill',
      backgroundColor,
    );

    clone.insertBefore(
      backgroundRect,
      clone.firstChild,
    );
  }

  /**
   * Place cloned chart content inside a padded group.
   */
  const contentGroup =
    document.createElementNS(
      'http://www.w3.org/2000/svg',
      'g',
    );

  contentGroup.setAttribute(
    'transform',
    `translate(${padding} ${padding})`,
  );

  while (
    clone.childNodes.length >
    0
  ) {
    const child =
      clone.firstChild;

    if (
      child?.nodeType ===
      Node.ELEMENT_NODE &&
      child.tagName?.toLowerCase() ===
        'style'
    ) {
      clone.removeChild(child);

      clone.appendChild(child);

      continue;
    }

    contentGroup.appendChild(
      child,
    );
  }

  clone.appendChild(
    contentGroup,
  );

  const serializer =
    new XMLSerializer();

  return {
    svgText:
      serializer.serializeToString(
        clone,
      ),
    width: totalWidth,
    height: totalHeight,
  };
}

/* ============================================================================
 * SVG → PNG
 * ========================================================================== */

async function svgToPngBlob(
  svg,
  {
    backgroundColor = '#ffffff',
    padding = DEFAULT_EXPORT_PADDING,
    scale = DEFAULT_PNG_SCALE,
  } = {},
) {
  if (
    typeof document ===
      'undefined' ||
    typeof Image === 'undefined'
  ) {
    throw new Error(
      'PNG export is unavailable outside a browser environment.',
    );
  }

  const {
    svgText,
    width,
    height,
  } =
    serializeSvg(svg, {
      backgroundColor,
      padding,
    });

  const svgBlob = new Blob(
    [svgText],
    {
      type: 'image/svg+xml;charset=utf-8',
    },
  );

  const svgUrl =
    URL.createObjectURL(
      svgBlob,
    );

  try {
    const image =
      await new Promise(
        (resolve, reject) => {
          const img =
            new Image();

          img.onload = () =>
            resolve(img);

          img.onerror = () =>
            reject(
              new Error(
                'The chart SVG could not be rendered as PNG.',
              ),
            );

          img.src = svgUrl;
        },
      );

    const safeScale =
      Number.isFinite(scale) &&
      scale > 0
        ? Math.min(scale, 4)
        : DEFAULT_PNG_SCALE;

    const canvas =
      document.createElement(
        'canvas',
      );

    canvas.width =
      Math.max(
        1,
        Math.round(
          width * safeScale,
        ),
      );

    canvas.height =
      Math.max(
        1,
        Math.round(
          height * safeScale,
        ),
      );

    const context =
      canvas.getContext(
        '2d',
      );

    if (!context) {
      throw new Error(
        'The browser could not create a PNG rendering context.',
      );
    }

    context.setTransform(
      safeScale,
      0,
      0,
      safeScale,
      0,
      0,
    );

    context.fillStyle =
      backgroundColor;

    context.fillRect(
      0,
      0,
      width,
      height,
    );

    context.drawImage(
      image,
      0,
      0,
      width,
      height,
    );

    const blob =
      await new Promise(
        (resolve) =>
          canvas.toBlob(
            resolve,
            'image/png',
          ),
      );

    if (!blob) {
      throw new Error(
        'The browser could not create the PNG file.',
      );
    }

    return blob;
  } finally {
    URL.revokeObjectURL(
      svgUrl,
    );
  }
}

/* ============================================================================
 * Print
 * ========================================================================== */

function printElement(
  element,
  {
    title = DEFAULT_DATASET_NAME,
  } = {},
) {
  if (
    typeof window ===
      'undefined' ||
    typeof document ===
      'undefined'
  ) {
    throw new Error(
      'Printing is available only in a browser environment.',
    );
  }

  if (!element) {
    throw new Error(
      'No chart element was found for printing.',
    );
  }

  const printWindow =
    window.open(
      '',
      '_blank',
      'noopener,noreferrer,width=1200,height=800',
    );

  if (!printWindow) {
    throw new Error(
      'The browser blocked the print window. Please allow pop-ups for TITech.',
    );
  }

  const styles = Array.from(
    document.styleSheets,
  )
    .map((sheet) => {
      try {
        return Array.from(
          sheet.cssRules || [],
        )
          .map(
            (rule) =>
              rule.cssText,
          )
          .join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');

  const clone =
    element.cloneNode(true);

  clone
    .querySelectorAll(
      'button, [data-export-ignore="true"]',
    )
    .forEach((node) =>
      node.remove(),
    );

  printWindow.document.open();

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />
        <title>${escapeHtml(title)}</title>
        <style>
          ${styles}

          html,
          body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #0f172a;
          }

          body {
            padding: 32px;
            font-family:
              system-ui,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif;
          }

          * {
            box-sizing: border-box;
          }

          @page {
            size: auto;
            margin: 16mm;
          }
        </style>
      </head>
      <body>
        ${clone.outerHTML}
      </body>
    </html>
  `);

  printWindow.document.close();

  printWindow.focus();

  const runPrint = () => {
    try {
      printWindow.print();
    } finally {
      window.setTimeout(
        () => {
          try {
            printWindow.close();
          } catch {
            // Ignore browser-specific close failures.
          }
        },
        500,
      );
    }
  };

  if (
    printWindow.document.readyState ===
    'complete'
  ) {
    window.setTimeout(
      runPrint,
      150,
    );
  } else {
    printWindow.onload = () =>
      window.setTimeout(
        runPrint,
        150,
      );
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(
      /&/g,
      '&amp;',
    )
    .replace(
      /</g,
      '&lt;',
    )
    .replace(
      />/g,
      '&gt;',
    )
    .replace(
      /"/g,
      '&quot;',
    )
    .replace(
      /'/g,
      '&#039;',
    );
}

/* ============================================================================
 * Export action definitions
 * ========================================================================== */

const DEFAULT_EXPORT_OPTIONS = [
  'csv',
  'json',
  'svg',
  'png',
  'print',
];

function normalizeExportOptions(
  options,
) {
  if (!Array.isArray(options)) {
    return DEFAULT_EXPORT_OPTIONS;
  }

  const allowed = new Set(
    DEFAULT_EXPORT_OPTIONS,
  );

  const normalized =
    options
      .map((option) =>
        String(option)
          .trim()
          .toLowerCase(),
      )
      .filter((option) =>
        allowed.has(option),
      );

  return Array.from(
    new Set(normalized),
  );
}

function getFormatLabel(
  format,
) {
  switch (format) {
    case 'csv':
      return 'CSV data';

    case 'json':
      return 'JSON data';

    case 'svg':
      return 'SVG chart';

    case 'png':
      return 'PNG chart';

    case 'print':
      return 'Print';

    default:
      return format;
  }
}

function getFormatIcon(
  format,
) {
  switch (format) {
    case 'csv':
      return 'CSV';

    case 'json':
      return '{}';

    case 'svg':
      return 'SVG';

    case 'png':
      return 'PNG';

    case 'print':
      return '⎙';

    default:
      return '↗';
  }
}

/* ============================================================================
 * Export execution
 * ========================================================================== */

async function executeExport(
  format,
  {
    data,
    chartRef,
    exportElementRef,
    filename,
    title,
    pngScale,
    pngBackground,
    svgBackground,
    padding,
    jsonPretty,
    csvBom,
    customExport,
  },
) {
  if (
    typeof customExport ===
    'function'
  ) {
    const handled =
      await customExport(
        format,
        {
          data,
          chartRef,
          exportElementRef,
          filename,
          title,
        },
      );

    if (handled === true) {
      return {
        handled: true,
        format,
      };
    }
  }

  const safeFilename =
    sanitizeFilename(
      filename,
    );

  switch (format) {
    case 'csv': {
      const csv =
        buildCsv(data, {
          includeBom:
            csvBom,
        });

      downloadText(
        csv,
        withExtension(
          safeFilename,
          DEFAULT_CSV_EXTENSION,
        ),
        'text/csv;charset=utf-8',
      );

      return {
        handled: false,
        format,
      };
    }

    case 'json': {
      const json =
        buildJson(data, {
          pretty:
            jsonPretty,
        });

      downloadText(
        json,
        withExtension(
          safeFilename,
          DEFAULT_JSON_EXTENSION,
        ),
        'application/json;charset=utf-8',
      );

      return {
        handled: false,
        format,
      };
    }

    case 'svg': {
      const target =
        resolveElement(
          exportElementRef ||
            chartRef,
        );

      const svg =
        findSvgElement(target);

      if (!svg) {
        throw new Error(
          'No SVG chart was found. Provide chartRef or exportElementRef pointing to the rendered chart.',
        );
      }

      const {
        svgText,
      } =
        serializeSvg(svg, {
          backgroundColor:
            svgBackground,
          padding,
        });

      downloadText(
        svgText,
        withExtension(
          safeFilename,
          DEFAULT_SVG_EXTENSION,
        ),
        'image/svg+xml;charset=utf-8',
      );

      return {
        handled: false,
        format,
      };
    }

    case 'png': {
      const target =
        resolveElement(
          exportElementRef ||
            chartRef,
        );

      const svg =
        findSvgElement(target);

      if (!svg) {
        throw new Error(
          'No SVG chart was found for PNG export. Provide chartRef or exportElementRef pointing to the rendered chart.',
        );
      }

      const pngBlob =
        await svgToPngBlob(
          svg,
          {
            backgroundColor:
              pngBackground,
            padding,
            scale:
              pngScale,
          },
        );

      downloadBlob(
        pngBlob,
        withExtension(
          safeFilename,
          DEFAULT_PNG_EXTENSION,
        ),
      );

      return {
        handled: false,
        format,
      };
    }

    case 'print': {
      const target =
        resolveElement(
          exportElementRef ||
            chartRef,
        );

      if (!target) {
        throw new Error(
          'No chart element was found for print export.',
        );
      }

      printElement(target, {
        title:
          title ||
          DEFAULT_DATASET_NAME,
      });

      return {
        handled: false,
        format,
      };
    }

    default:
      throw new Error(
        `Unsupported export format: ${format}`,
      );
  }
}

/* ============================================================================
 * Default icon
 * ========================================================================== */

const ExportIcon = memo(
  function ExportIcon() {
    return (
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M12 3V15"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <path
          d="M7 10L12 15L17 10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          d="M5 20H19"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  },
);

ExportIcon.displayName =
  'ExportIcon';

/* ============================================================================
 * Menu option
 * ========================================================================== */

const ExportOption = memo(
  function ExportOption({
    format,
    disabled,
    onClick,
  }) {
    return (
      <button
        type="button"
        className="titech-chart-export__option"
        role="menuitem"
        disabled={disabled}
        onClick={() =>
          onClick(format)
        }
      >
        <span
          className="titech-chart-export__option-icon"
          aria-hidden="true"
        >
          {getFormatIcon(format)}
        </span>

        <span className="titech-chart-export__option-label">
          {getFormatLabel(format)}
        </span>
      </button>
    );
  },
);

ExportOption.displayName =
  'ExportOption';

/* ============================================================================
 * Main component
 * ========================================================================== */

const ChartExportButton = memo(
  forwardRef(function ChartExportButton(
    {
      data = [],

      chartRef = null,

      exportElementRef = null,

      filename = DEFAULT_FILENAME,

      title =
        DEFAULT_DATASET_NAME,

      formats = DEFAULT_EXPORT_OPTIONS,

      mode = 'menu',

      defaultFormat = 'csv',

      label =
        DEFAULT_BUTTON_LABEL,

      menuLabel =
        DEFAULT_MENU_LABEL,

      loadingLabel =
        DEFAULT_LOADING_LABEL,

      icon = null,

      disabled = false,

      size = 'medium',

      variant = 'secondary',

      fullWidth = false,

      align = 'right',

      closeOnExport = true,

      closeOnEscape = true,

      jsonPretty = true,

      csvBom = true,

      pngScale = DEFAULT_PNG_SCALE,

      pngBackground = '#ffffff',

      svgBackground = null,

      padding = DEFAULT_EXPORT_PADDING,

      successDuration =
        DEFAULT_SUCCESS_DURATION,

      onBeforeExport = null,

      onExport = null,

      onExportSuccess = null,

      onExportError = null,

      customExport = null,

      showStatus = true,

      statusAnnouncement = true,

      statusMessage = null,

      className = '',

      buttonClassName = '',

      menuClassName = '',

      style = undefined,

      buttonStyle = undefined,

      menuStyle = undefined,

      ariaLabel = null,

      tooltip = null,

      titleAttribute = null,

      testId = null,

      id = null,
    },
    forwardedRef,
  ) {
    const generatedId =
      useId();

    const rootRef =
      useRef(null);

    const buttonRef =
      useRef(null);

    const menuRef =
      useRef(null);

    const [open, setOpen] =
      useState(false);

    const [exporting, setExporting] =
      useState(false);

    const [success, setSuccess] =
      useState(false);

    const [status, setStatus] =
      useState(
        statusMessage || '',
      );

    const [failure, setFailure] =
      useState('');

    const availableFormats =
      useMemo(
        () =>
          normalizeExportOptions(
            formats,
          ),
        [formats],
      );

    const normalizedDefaultFormat =
      availableFormats.includes(
        String(defaultFormat)
          .toLowerCase(),
      )
        ? String(defaultFormat)
            .toLowerCase()
        : availableFormats[0] ||
          'csv';

    const safeFilename =
      useMemo(
        () =>
          sanitizeFilename(
            filename,
          ),
        [filename],
      );

    const menuId = useMemo(
      () =>
        id
          ? `${id}-menu`
          : `${generatedId}-menu`,
      [id, generatedId],
    );

    const statusId = useMemo(
      () =>
        id
          ? `${id}-status`
          : `${generatedId}-status`,
      [id, generatedId],
    );

    const setForwardedRef =
      useCallback(
        (node) => {
          rootRef.current = node;

          if (
            typeof forwardedRef ===
            'function'
          ) {
            forwardedRef(node);
          } else if (
            forwardedRef
          ) {
            forwardedRef.current =
              node;
          }
        },
        [forwardedRef],
      );

    const clearStatusLater =
      useCallback(() => {
        if (
          typeof window ===
          'undefined'
        ) {
          return;
        }

        window.setTimeout(
          () => {
            setSuccess(false);
            setStatus('');
          },
          Math.max(
            800,
            Number(
              successDuration,
            ) ||
              DEFAULT_SUCCESS_DURATION,
          ),
        );
      }, [successDuration]);

    const handleExport =
      useCallback(
        async (format) => {
          if (
            disabled ||
            exporting
          ) {
            return;
          }

          const normalizedFormat =
            String(format)
              .toLowerCase();

          setFailure('');
          setSuccess(false);
          setStatus(
            `Preparing ${getFormatLabel(
              normalizedFormat,
            )}…`,
          );

          if (
            typeof onBeforeExport ===
            'function'
          ) {
            try {
              await onBeforeExport({
                format:
                  normalizedFormat,
                filename:
                  safeFilename,
                data,
              });
            } catch (error) {
              const message =
                getErrorMessage(
                  error,
                  'The export was cancelled before it started.',
                );

              setFailure(message);
              setStatus(message);

              if (
                typeof onExportError ===
                'function'
              ) {
                onExportError(
                  error,
                  {
                    format:
                      normalizedFormat,
                    filename:
                      safeFilename,
                  },
                );
              }

              return;
            }
          }

          setExporting(true);

          try {
            const result =
              await executeExport(
                normalizedFormat,
                {
                  data,
                  chartRef,
                  exportElementRef,
                  filename:
                    safeFilename,
                  title,
                  pngScale,
                  pngBackground,
                  svgBackground,
                  padding,
                  jsonPretty,
                  csvBom,
                  customExport,
                },
              );

            setSuccess(true);

            const successText =
              `${getFormatLabel(
                normalizedFormat,
              )} export completed.`;

            setStatus(
              successText,
            );

            if (
              typeof onExport ===
              'function'
            ) {
              await onExport({
                ...result,
                format:
                  normalizedFormat,
                filename:
                  safeFilename,
                data,
              });
            }

            if (
              typeof onExportSuccess ===
              'function'
            ) {
              await onExportSuccess({
                ...result,
                format:
                  normalizedFormat,
                filename:
                  safeFilename,
                data,
              });
            }

            if (closeOnExport) {
              setOpen(false);
            }

            clearStatusLater();
          } catch (error) {
            const message =
              getErrorMessage(
                error,
                'The export could not be completed.',
              );

            setFailure(message);
            setStatus(message);

            if (
              typeof onExportError ===
              'function'
            ) {
              await onExportError(
                error,
                {
                  format:
                    normalizedFormat,
                  filename:
                    safeFilename,
                  data,
                },
              );
            }
          } finally {
            setExporting(false);
          }
        },
        [
          disabled,
          exporting,
          onBeforeExport,
          safeFilename,
          data,
          chartRef,
          exportElementRef,
          title,
          pngScale,
          pngBackground,
          svgBackground,
          padding,
          jsonPretty,
          csvBom,
          customExport,
          onExport,
          onExportSuccess,
          onExportError,
          closeOnExport,
          clearStatusLater,
        ],
      );

    const handlePrimaryClick =
      useCallback(() => {
        if (
          mode === 'single'
        ) {
          void handleExport(
            normalizedDefaultFormat,
          );

          return;
        }

        setFailure('');

        setOpen(
          (previous) =>
            !previous,
        );
      }, [
        mode,
        handleExport,
        normalizedDefaultFormat,
      ]);

    /**
     * Close the menu after an outside interaction.
     */
    useEffect(() => {
      if (!open) {
        return undefined;
      }

      const handlePointerDown =
        (event) => {
          const root =
            rootRef.current;

          if (
            root &&
            !root.contains(
              event.target,
            )
          ) {
            setOpen(false);
          }
        };

      document.addEventListener(
        'pointerdown',
        handlePointerDown,
      );

      return () =>
        document.removeEventListener(
          'pointerdown',
          handlePointerDown,
        );
    }, [open]);

    /**
     * Escape closes the menu and returns focus to the main export button.
     */
    useEffect(() => {
      if (!open || !closeOnEscape) {
        return undefined;
      }

      const handleKeyDown =
        (event) => {
          if (
            event.key ===
            'Escape'
          ) {
            event.preventDefault();

            setOpen(false);

            window.requestAnimationFrame(
              () => {
                buttonRef.current?.focus();
              },
            );
          }

          if (
            event.key === 'Tab'
          ) {
            const menu =
              menuRef.current;

            if (!menu) {
              return;
            }

            const focusable =
              menu.querySelectorAll(
                'button:not(:disabled)',
              );

            if (
              focusable.length ===
              0
            ) {
              return;
            }

            const first =
              focusable[0];

            const last =
              focusable[
                focusable.length - 1
              ];

            if (
              event.shiftKey &&
              document.activeElement ===
                first
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement ===
                last
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        };

      document.addEventListener(
        'keydown',
        handleKeyDown,
      );

      return () =>
        document.removeEventListener(
          'keydown',
          handleKeyDown,
        );
    }, [
      open,
      closeOnEscape,
    ]);

    /**
     * When a menu opens, move focus to its first active option.
     */
    useEffect(() => {
      if (!open) {
        return;
      }

      window.requestAnimationFrame(
        () => {
          menuRef.current
            ?.querySelector(
              'button:not(:disabled)',
            )
            ?.focus();
        },
      );
    }, [open]);

    const rootClasses = classNames(
      'titech-chart-export',
      `titech-chart-export--${size}`,
      `titech-chart-export--${variant}`,
      fullWidth &&
        'titech-chart-export--full-width',
      `titech-chart-export--align-${align}`,
      className,
    );

    const buttonClasses = classNames(
      'titech-chart-export__button',
      buttonClassName,
    );

    const effectiveAriaLabel =
      ariaLabel ||
      (mode === 'single'
        ? `${label} ${getFormatLabel(
            normalizedDefaultFormat,
          )}`
        : menuLabel);

    const effectiveTitle =
      titleAttribute ||
      tooltip ||
      effectiveAriaLabel;

    if (
      availableFormats.length ===
      0
    ) {
      return null;
    }

    return (
      <div
        ref={setForwardedRef}
        className={rootClasses}
        style={style}
        data-testid={
          testId || undefined
        }
        data-component={
          COMPONENT_NAME
        }
      >
        <button
          ref={buttonRef}
          type="button"
          className={buttonClasses}
          disabled={
            disabled ||
            exporting
          }
          aria-label={
            effectiveAriaLabel
          }
          aria-haspopup={
            mode === 'menu'
              ? 'menu'
              : undefined
          }
          aria-expanded={
            mode === 'menu'
              ? open
              : undefined
          }
          aria-controls={
            mode === 'menu'
              ? menuId
              : undefined
          }
          aria-describedby={
            statusAnnouncement &&
            status
              ? statusId
              : undefined
          }
          title={
            effectiveTitle
          }
          onClick={
            handlePrimaryClick
          }
        >
          <span
            className="titech-chart-export__button-icon"
            aria-hidden="true"
          >
            {exporting ? (
              <span className="titech-chart-export__spinner" />
            ) : (
              icon || (
                <ExportIcon />
              )
            )}
          </span>

          <span>
            {exporting
              ? loadingLabel
              : label}
          </span>

          {mode === 'menu' ? (
            <svg
              className={classNames(
                'titech-chart-export__chevron',
                open &&
                  'titech-chart-export__chevron--open',
              )}
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 9L12 15L18 9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </button>

        {mode === 'menu' &&
        open ? (
          <div
            ref={menuRef}
            id={menuId}
            className={classNames(
              'titech-chart-export__menu',
              `titech-chart-export__menu--${align}`,
              menuClassName,
            )}
            role="menu"
            aria-label={
              `${menuLabel} options`
            }
            style={menuStyle}
          >
            <div className="titech-chart-export__menu-heading">
              Export
            </div>

            {availableFormats.map(
              (format) => (
                <ExportOption
                  key={format}
                  format={format}
                  disabled={
                    exporting
                  }
                  onClick={
                    handleExport
                  }
                />
              ),
            )}
          </div>
        ) : null}

        {showStatus &&
        (success ||
          failure ||
          status) ? (
          <div
            id={statusId}
            className={classNames(
              'titech-chart-export__status',
              success &&
                'titech-chart-export__status--success',
              failure &&
                'titech-chart-export__status--error',
            )}
            role={
              failure
                ? 'alert'
                : 'status'
            }
            aria-live="polite"
          >
            <span
              className="titech-chart-export__status-dot"
              aria-hidden="true"
            />

            <span>
              {failure ||
                status}
            </span>
          </div>
        ) : null}

        <style>
          {`
            .titech-chart-export {
              --titech-export-primary:
                var(
                  --titech-primary,
                  #0f172a
                );

              --titech-export-primary-hover:
                var(
                  --titech-primary-hover,
                  #1e293b
                );

              --titech-export-surface:
                var(
                  --titech-surface,
                  #ffffff
                );

              --titech-export-surface-muted:
                var(
                  --titech-surface-muted,
                  #f8fafc
                );

              --titech-export-border:
                var(
                  --titech-border,
                  #e2e8f0
                );

              --titech-export-border-strong:
                var(
                  --titech-border-strong,
                  #cbd5e1
                );

              --titech-export-text:
                var(
                  --titech-text-primary,
                  #0f172a
                );

              --titech-export-text-muted:
                var(
                  --titech-text-secondary,
                  #64748b
                );

              --titech-export-focus:
                var(
                  --titech-focus-ring,
                  #2563eb
                );

              --titech-export-success:
                var(
                  --titech-success,
                  #047857
                );

              --titech-export-success-surface:
                var(
                  --titech-success-surface,
                  #ecfdf5
                );

              --titech-export-danger:
                var(
                  --titech-danger,
                  #b91c1c
                );

              --titech-export-danger-surface:
                var(
                  --titech-danger-surface,
                  #fff7f7
                );

              position: relative;
              display: inline-flex;
              align-items: flex-start;
              width: auto;
              max-width: 100%;
              color:
                var(--titech-export-text);
              font: inherit;
              z-index: 20;
            }

            .titech-chart-export--full-width {
              display: flex;
              width: 100%;
            }

            .titech-chart-export--align-left {
              justify-content: flex-start;
            }

            .titech-chart-export--align-center {
              justify-content: center;
            }

            .titech-chart-export--align-right {
              justify-content: flex-end;
            }

            .titech-chart-export__button {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 7px;
              min-width: 0;
              border: 1px solid
                var(--titech-export-border-strong);
              border-radius: 9px;
              background:
                var(--titech-export-surface);
              color:
                var(--titech-export-text);
              font: inherit;
              font-weight: 750;
              line-height: 1.2;
              cursor: pointer;
              user-select: none;
              white-space: nowrap;
              box-shadow:
                0 1px 2px
                rgba(15, 23, 42, 0.04);
              transition:
                background-color 140ms ease,
                border-color 140ms ease,
                color 140ms ease,
                box-shadow 140ms ease,
                opacity 140ms ease;
            }

            .titech-chart-export__button:hover:not(
              :disabled
            ) {
              background:
                var(
                  --titech-export-surface-muted
                );
              border-color:
                var(--titech-export-border-strong);
              box-shadow:
                0 3px 10px
                rgba(15, 23, 42, 0.08);
            }

            .titech-chart-export__button:active:not(
              :disabled
            ) {
              transform: translateY(1px);
            }

            .titech-chart-export__button:disabled {
              cursor: not-allowed;
              opacity: 0.58;
            }

            .titech-chart-export__button:focus-visible,
            .titech-chart-export__option:focus-visible {
              outline: 3px solid
                var(--titech-export-focus);
              outline-offset: 2px;
            }

            .titech-chart-export--primary
              .titech-chart-export__button {
              border-color:
                var(--titech-export-primary);
              background:
                var(--titech-export-primary);
              color: #ffffff;
            }

            .titech-chart-export--primary
              .titech-chart-export__button:hover:not(
                :disabled
              ) {
              background:
                var(
                  --titech-export-primary-hover
                );
              border-color:
                var(
                  --titech-export-primary-hover
                );
            }

            .titech-chart-export--ghost
              .titech-chart-export__button {
              border-color: transparent;
              background: transparent;
              box-shadow: none;
            }

            .titech-chart-export--ghost
              .titech-chart-export__button:hover:not(
                :disabled
              ) {
              background:
                var(
                  --titech-export-surface-muted
                );
              border-color:
                var(--titech-export-border);
            }

            .titech-chart-export--compact
              .titech-chart-export__button,
            .titech-chart-export--small
              .titech-chart-export__button {
              min-height: 32px;
              padding: 6px 9px;
              font-size: 11px;
            }

            .titech-chart-export--medium
              .titech-chart-export__button {
              min-height: 38px;
              padding: 8px 12px;
              font-size: 12px;
            }

            .titech-chart-export--large
              .titech-chart-export__button {
              min-height: 44px;
              padding: 10px 15px;
              font-size: 13px;
            }

            .titech-chart-export--full-width
              .titech-chart-export__button {
              width: 100%;
            }

            .titech-chart-export__button-icon {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              flex: 0 0 auto;
            }

            .titech-chart-export__spinner {
              width: 16px;
              height: 16px;
              border: 2px solid
                currentColor;
              border-right-color:
                transparent;
              border-radius: 50%;
              animation:
                titech-chart-export-spin
                700ms linear infinite;
            }

            .titech-chart-export__chevron {
              flex: 0 0 auto;
              transition:
                transform 140ms ease;
            }

            .titech-chart-export__chevron--open {
              transform: rotate(180deg);
            }

            .titech-chart-export__menu {
              position: absolute;
              top: calc(100% + 7px);
              min-width: 190px;
              max-width: min(
                280px,
                calc(100vw - 24px)
              );
              padding: 6px;
              border: 1px solid
                var(--titech-export-border);
              border-radius: 12px;
              background:
                var(--titech-export-surface);
              box-shadow:
                0 18px 45px
                rgba(15, 23, 42, 0.16);
              z-index: 100;
            }

            .titech-chart-export__menu--right {
              right: 0;
            }

            .titech-chart-export__menu--left {
              left: 0;
            }

            .titech-chart-export__menu--center {
              left: 50%;
              transform:
                translateX(-50%);
            }

            .titech-chart-export__menu-heading {
              padding: 7px 9px 8px;
              color:
                var(
                  --titech-export-text-muted
                );
              font-size: 10px;
              line-height: 1.2;
              font-weight: 800;
              letter-spacing: 0.07em;
              text-transform: uppercase;
            }

            .titech-chart-export__option {
              display: flex;
              align-items: center;
              width: 100%;
              gap: 10px;
              min-height: 37px;
              padding: 8px 9px;
              border: 0;
              border-radius: 8px;
              background: transparent;
              color:
                var(--titech-export-text);
              font: inherit;
              font-size: 12px;
              font-weight: 650;
              text-align: left;
              cursor: pointer;
            }

            .titech-chart-export__option:hover:not(
              :disabled
            ) {
              background:
                var(
                  --titech-export-surface-muted
                );
            }

            .titech-chart-export__option:disabled {
              cursor: not-allowed;
              opacity: 0.5;
            }

            .titech-chart-export__option-icon {
              display: grid;
              place-items: center;
              width: 31px;
              height: 27px;
              flex: 0 0 auto;
              border: 1px solid
                var(--titech-export-border);
              border-radius: 7px;
              color:
                var(--titech-export-text-muted);
              font-size: 8px;
              font-weight: 850;
              letter-spacing: 0.03em;
            }

            .titech-chart-export__option-label {
              min-width: 0;
              overflow-wrap: anywhere;
            }

            .titech-chart-export__status {
              position: absolute;
              top: calc(100% + 7px);
              right: 0;
              display: inline-flex;
              align-items: flex-start;
              gap: 7px;
              min-width: 190px;
              max-width: min(
                320px,
                calc(100vw - 24px)
              );
              padding: 8px 10px;
              border: 1px solid
                var(--titech-export-border);
              border-radius: 8px;
              background:
                var(--titech-export-surface);
              color:
                var(--titech-export-text-muted);
              box-shadow:
                0 8px 24px
                rgba(15, 23, 42, 0.1);
              font-size: 10px;
              line-height: 1.4;
              z-index: 110;
            }

            .titech-chart-export__status--success {
              border-color:
                var(
                  --titech-export-success
                );
              background:
                var(
                  --titech-export-success-surface
                );
              color:
                var(
                  --titech-export-success
                );
            }

            .titech-chart-export__status--error {
              border-color:
                var(
                  --titech-export-danger
                );
              background:
                var(
                  --titech-export-danger-surface
                );
              color:
                var(
                  --titech-export-danger
                );
            }

            .titech-chart-export__status-dot {
              width: 6px;
              height: 6px;
              margin-top: 4px;
              flex: 0 0 auto;
              border-radius: 50%;
              background: currentColor;
            }

            @keyframes titech-chart-export-spin {
              to {
                transform: rotate(360deg);
              }
            }

            @media (max-width: 560px) {
              .titech-chart-export__menu {
                position: fixed;
                top: auto;
                left: 12px;
                right: 12px;
                bottom: 12px;
                max-width: none;
                min-width: 0;
              }

              .titech-chart-export__menu--center {
                transform: none;
              }

              .titech-chart-export__status {
                left: 0;
                right: 0;
                max-width: none;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .titech-chart-export *,
              .titech-chart-export
                *::before,
              .titech-chart-export
                *::after {
                animation: none !important;
                transition: none !important;
              }
            }

            @media print {
              .titech-chart-export {
                display: none !important;
              }
            }
          `}
        </style>
      </div>
    );
  }),
);

ChartExportButton.displayName =
  COMPONENT_NAME;

/* ============================================================================
 * Static utility exports
 * ========================================================================== */

export {
  ChartExportButton,
  buildCsv,
  buildJson,
  escapeCsvCell,
  normalizeRows,
  sanitizeFilename,
  withExtension,
};

/* ============================================================================
 * Default export
 * ========================================================================== */

export default ChartExportButton;