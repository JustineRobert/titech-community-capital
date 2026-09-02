'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File Upload Test Helpers
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ File Upload Testing
 * ✅ Drag & Drop Testing
 * ✅ Multiple File Upload Testing
 * ✅ KYC Document Testing
 * ✅ Loan Attachment Testing
 * ✅ SACCO Registration Testing
 * ✅ Image Upload Testing
 * ✅ PDF Upload Testing
 * ✅ Excel Upload Testing
 * ✅ CSV Upload Testing
 * ✅ File Validation Testing
 * ✅ Jest Compatible
 * ✅ Vitest Compatible
 * ✅ RTL Compatible
 * ============================================================================
 */

const {
    fireEvent,
    waitFor
} = require(
    '@testing-library/react'
);

/* ============================================================================
   MIME TYPES
============================================================================ */

const FILE_TYPES = {

    PDF:
        'application/pdf',

    PNG:
        'image/png',

    JPEG:
        'image/jpeg',

    JPG:
        'image/jpg',

    CSV:
        'text/csv',

    XLSX:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    DOCX:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    TXT:
        'text/plain'
};

/* ============================================================================
   FILE FACTORY
============================================================================ */

function createMockFile({

    name = 'test-file.pdf',

    type = FILE_TYPES.PDF,

    size = 1024,

    content = 'Mock File Content'

} = {}) {

    const file =
        new File(
            [content],
            name,
            { type }
        );

    Object.defineProperty(
        file,
        'size',
        {
            value: size
        }
    );

    return file;
}

/* ============================================================================
   PREBUILT FILES
============================================================================ */

function createPdfFile(
    overrides = {}
) {

    return createMockFile({

        name:
            'document.pdf',

        type:
            FILE_TYPES.PDF,

        ...overrides
    });
}

function createImageFile(
    overrides = {}
) {

    return createMockFile({

        name:
            'photo.png',

        type:
            FILE_TYPES.PNG,

        ...overrides
    });
}

function createExcelFile(
    overrides = {}
) {

    return createMockFile({

        name:
            'report.xlsx',

        type:
            FILE_TYPES.XLSX,

        ...overrides
    });
}

function createCsvFile(
    overrides = {}
) {

    return createMockFile({

        name:
            'import.csv',

        type:
            FILE_TYPES.CSV,

        ...overrides
    });
}

function createWordFile(
    overrides = {}
) {

    return createMockFile({

        name:
            'document.docx',

        type:
            FILE_TYPES.DOCX,

        ...overrides
    });
}

/* ============================================================================
   BUSINESS DOCUMENT FACTORIES
============================================================================ */

function createNationalIdFile() {

    return createImageFile({

        name:
            'national-id-front.jpg',

        type:
            FILE_TYPES.JPEG
    });
}

function createPassportPhoto() {

    return createImageFile({

        name:
            'passport-photo.png'
    });
}

function createLoanAttachment() {

    return createPdfFile({

        name:
            'loan-application.pdf'
    });
}

function createBoardResolution() {

    return createPdfFile({

        name:
            'board-resolution.pdf'
    });
}

function createSaccoRegistrationCertificate() {

    return createPdfFile({

        name:
            'registration-certificate.pdf'
    });
}

/* ============================================================================
   FILE INPUT HELPERS
============================================================================ */

async function uploadFile(
    input,
    file
) {

    fireEvent.change(
        input,
        {
            target: {
                files: [file]
            }
        }
    );

    await waitFor(
        () =>
            expect(
                input.files
            ).toHaveLength(
                1
            )
    );

    return file;
}

async function uploadFiles(
    input,
    files
) {

    fireEvent.change(
        input,
        {
            target: {
                files
            }
        }
    );

    await waitFor(
        () =>
            expect(
                input.files.length
            ).toBe(
                files.length
            )
    );

    return files;
}

/* ============================================================================
   DRAG AND DROP
============================================================================ */

async function dragAndDropFiles(
    dropZone,
    files
) {

    fireEvent.dragEnter(
        dropZone
    );

    fireEvent.dragOver(
        dropZone
    );

    fireEvent.drop(
        dropZone,
        {
            dataTransfer: {
                files
            }
        }
    );

    return files;
}

/* ============================================================================
   FILE LIST GENERATORS
============================================================================ */

function createLoanDocumentBundle() {

    return [

        createLoanAttachment(),

        createNationalIdFile(),

        createPassportPhoto()
    ];
}

function createSaccoOnboardingBundle() {

    return [

        createSaccoRegistrationCertificate(),

        createBoardResolution()
    ];
}

function createBulkMemberImportBundle() {

    return [

        createCsvFile(),

        createExcelFile()
    ];
}

/* ============================================================================
   VALIDATION HELPERS
============================================================================ */

function createOversizedFile({

    size = 15 * 1024 * 1024,

    name = 'oversized.pdf'

} = {}) {

    return createMockFile({

        name,

        size,

        type:
            FILE_TYPES.PDF
    });
}

function createUnsupportedFile() {

    return createMockFile({

        name:
            'virus.exe',

        type:
            'application/x-msdownload'
    });
}

/* ============================================================================
   ASSERTION HELPERS
============================================================================ */

function expectUploadedFile(
    input,
    fileName
) {

    expect(
        input.files[0].name
    ).toBe(
        fileName
    );
}

function expectUploadedFiles(
    input,
    count
) {

    expect(
        input.files.length
    ).toBe(
        count
    );
}

/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {

    FILE_TYPES,

    createMockFile,

    createPdfFile,
    createImageFile,
    createExcelFile,
    createCsvFile,
    createWordFile,

    createNationalIdFile,
    createPassportPhoto,
    createLoanAttachment,
    createBoardResolution,
    createSaccoRegistrationCertificate,

    uploadFile,
    uploadFiles,

    dragAndDropFiles,

    createLoanDocumentBundle,
    createSaccoOnboardingBundle,
    createBulkMemberImportBundle,

    createOversizedFile,
    createUnsupportedFile,

    expectUploadedFile,
    expectUploadedFiles
};