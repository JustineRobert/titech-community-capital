'use strict';

/**
 * ============================================================================
 * ATTACHMENT VALIDATION MIDDLEWARE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Validates uploaded message attachments before they are stored or processed.
 *
 * SECURITY FEATURES
 * ----------------------------------------------------------------------------
 * ✅ MIME Type Whitelisting
 * ✅ Dangerous File Blocking
 * ✅ File Size Validation
 * ✅ Extension Validation
 * ✅ Upload Count Limits
 * ✅ Malware Prevention Ready
 * ✅ Compliance Ready
 * ✅ Audit Ready
 *
 * ALLOWED FILE TYPES
 * ----------------------------------------------------------------------------
 * PDF
 * PNG
 * JPG
 * JPEG
 * DOC
 * DOCX
 * XLS
 * XLSX
 * CSV
 * TXT
 *
 * BLOCKED FILE TYPES
 * ----------------------------------------------------------------------------
 * EXE
 * DLL
 * BAT
 * CMD
 * PS1
 * SH
 * APK
 * MSI
 * JAR
 * VBS
 * SCR
 *
 * ============================================================================
 */

const path = require('path');

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const ALLOWED_MIME_TYPES = [
  'application/pdf',

  'image/png',
  'image/jpg',
  'image/jpeg',

  'application/msword',

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  'application/vnd.ms-excel',

  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  'text/csv',
  'text/plain',
];

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
];

const BLOCKED_EXTENSIONS = [
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.apk',
  '.msi',
  '.jar',
  '.vbs',
  '.scr',
  '.com',
];

const MAX_FILE_SIZE =
  Number(
    process.env.CHAT_ATTACHMENT_MAX_SIZE
  ) ||
  10 * 1024 * 1024; // 10MB

const MAX_FILES =
  Number(
    process.env.CHAT_ATTACHMENT_MAX_FILES
  ) || 5;

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function getFiles(req) {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  if (
    req.files &&
    typeof req.files === 'object'
  ) {
    return Object.values(
      req.files
    ).flat();
  }

  if (req.file) {
    return [req.file];
  }

  return [];
}

function getExtension(
  filename = ''
) {
  return path
    .extname(filename)
    .toLowerCase();
}

function isBlockedExtension(
  extension
) {
  return BLOCKED_EXTENSIONS.includes(
    extension
  );
}

function isAllowedExtension(
  extension
) {
  return ALLOWED_EXTENSIONS.includes(
    extension
  );
}

/*
|--------------------------------------------------------------------------
| Middleware
|--------------------------------------------------------------------------
*/

function attachmentValidation(
  req,
  res,
  next
) {
  try {
    const files =
      getFiles(req);

    /*
    |--------------------------------------------------------------------------
    | No Files
    |--------------------------------------------------------------------------
    */

    if (
      !files.length
    ) {
      return next();
    }

    /*
    |--------------------------------------------------------------------------
    | File Count Validation
    |--------------------------------------------------------------------------
    */

    if (
      files.length >
      MAX_FILES
    ) {
      return res.status(400).json({
        success: false,
        message: `Maximum of ${MAX_FILES} files allowed.`,
        code:
          'MAX_FILES_EXCEEDED',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | File Validation
    |--------------------------------------------------------------------------
    */

    for (const file of files) {
      const mimeType =
        file.mimetype ||
        file.mimeType ||
        '';

      const fileName =
        file.originalname ||
        file.name ||
        'unknown';

      const extension =
        getExtension(
          fileName
        );

      /*
      |--------------------------------------------------------------------------
      | Dangerous Extensions
      |--------------------------------------------------------------------------
      */

      if (
        isBlockedExtension(
          extension
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              `Blocked file type: ${extension}`,
            code:
              'BLOCKED_FILE_TYPE',
            file:
              fileName,
          });
      }

      /*
      |--------------------------------------------------------------------------
      | Allowed Extension Validation
      |--------------------------------------------------------------------------
      */

      if (
        !isAllowedExtension(
          extension
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              `File extension not allowed: ${extension}`,
            code:
              'INVALID_FILE_EXTENSION',
            file:
              fileName,
          });
      }

      /*
      |--------------------------------------------------------------------------
      | MIME Type Validation
      |--------------------------------------------------------------------------
      */

      if (
        !ALLOWED_MIME_TYPES.includes(
          mimeType
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              `Attachment type not allowed: ${mimeType}`,
            code:
              'INVALID_MIME_TYPE',
            file:
              fileName,
          });
      }

      /*
      |--------------------------------------------------------------------------
      | File Size Validation
      |--------------------------------------------------------------------------
      */

      if (
        file.size >
        MAX_FILE_SIZE
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              `File exceeds maximum size of ${Math.round(
                MAX_FILE_SIZE /
                  1024 /
                  1024
              )}MB.`,
            code:
              'FILE_TOO_LARGE',
            file:
              fileName,
          });
      }

      /*
      |--------------------------------------------------------------------------
      | Empty File Protection
      |--------------------------------------------------------------------------
      */

      if (
        file.size <= 0
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              'Empty file uploads are not allowed.',
            code:
              'EMPTY_FILE',
            file:
              fileName,
          });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports =
  attachmentValidation;

module.exports.ALLOWED_MIME_TYPES =
  ALLOWED_MIME_TYPES;

module.exports.ALLOWED_EXTENSIONS =
  ALLOWED_EXTENSIONS;

module.exports.BLOCKED_EXTENSIONS =
  BLOCKED_EXTENSIONS;

module.exports.MAX_FILE_SIZE =
  MAX_FILE_SIZE;

module.exports.MAX_FILES =
  MAX_FILES;