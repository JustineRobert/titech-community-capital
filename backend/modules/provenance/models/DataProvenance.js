/**
 * ============================================================================
 * TITech Community Capital — Data Provenance Record
 * ============================================================================
 * Role: evidence lineage for financial/risk data and derived signals.
 * Non-responsibilities: scoring, consent granting, payment execution or ledger mutation.
 * ============================================================================
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

const DataProvenanceSchema = new Schema({
  tenantId: { type: String, required: true, index: true, immutable: true },
  subjectType: { type: String, required: true, trim: true },
  subjectId: { type: String, required: true, trim: true, index: true },
  dataType: { type: String, required: true, trim: true },
  sourceType: { type: String, required: true, trim: true },
  sourceId: { type: String, required: true, trim: true },
  sourceEventId: { type: String, default: null, trim: true },
  collectedAt: { type: Date, required: true },
  transformation: { type: String, default: 'NONE', trim: true },
  validationStatus: { type: String, required: true, enum: ['RAW', 'VALIDATED', 'VERIFIED', 'REJECTED'] },
  confidence: { type: Number, min: 0, max: 1, default: 1 },
  consentId: { type: String, default: null },
  purpose: { type: String, required: true, trim: true },
  consumer: { type: String, default: null, trim: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: 'throw' });

DataProvenanceSchema.index({ tenantId: 1, subjectId: 1, dataType: 1, collectedAt: -1 });
DataProvenanceSchema.index({ tenantId: 1, sourceId: 1, sourceEventId: 1 });

export default mongoose.models.DataProvenance || mongoose.model('DataProvenance', DataProvenanceSchema);
