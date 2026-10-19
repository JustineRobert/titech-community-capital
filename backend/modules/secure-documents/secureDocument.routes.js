import express from 'express';
import { downloadPrivateDocument, uploadPrivateDocument } from './secureDocument.controller.js';

const router = express.Router();

// Raw binary uploads bypass JSON parsing but stay behind canonical auth and
// tenant middleware at the route-registry boundary. No base64/JSON file blobs.
router.post('/upload', express.raw({ type: ['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png'], limit: '10mb' }), uploadPrivateDocument);
router.get('/:documentReference', downloadPrivateDocument);

export default router;
