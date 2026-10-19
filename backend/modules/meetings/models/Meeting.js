/**
 * TITech Community Capital — canonical meeting record.
 * Organization: TITech Capital LTD.
 * Meeting decisions are records of governance, never payment or ledger commands.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;
const participantSchema = new Schema({
  identityRef: { type: String, required: true, trim: true, maxlength: 128 },
  identityType: { type: String, enum: ['USER', 'MEMBER'], default: 'USER', required: true },
  participationMode: { type: String, enum: ['IN_PERSON', 'REMOTE', 'HYBRID'], default: 'REMOTE', required: true },
  invitationStatus: { type: String, enum: ['INVITED', 'ACCEPTED', 'DECLINED', 'REMOVED'], default: 'INVITED', required: true },
  participantRole: { type: String, enum: ['PARTICIPANT', 'CHAIR', 'SECRETARY', 'FACILITATOR'], default: 'PARTICIPANT' },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
}, { _id: false, strict: 'throw' });

const agendaSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  ownerRef: { type: String, trim: true, maxlength: 128, default: null },
  durationMinutes: { type: Number, min: 1, max: 600, default: null },
  sequence: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ['PENDING', 'IN_PROGRESS', 'DISCUSSED', 'DEFERRED'], default: 'PENDING' },
}, { timestamps: true, strict: 'throw' });

const attendanceSchema = new Schema({
  identityRef: { type: String, required: true, trim: true, maxlength: 128 },
  identityType: { type: String, enum: ['USER', 'MEMBER'], default: 'USER' },
  participationMode: { type: String, enum: ['IN_PERSON', 'REMOTE', 'HYBRID'], required: true },
  attendanceStatus: { type: String, enum: ['PRESENT', 'ABSENT', 'EXCUSED', 'PROVISIONAL'], default: 'PROVISIONAL' },
  source: { type: String, enum: ['SELF_REPORTED', 'ORGANIZER_RECORDED', 'PROVIDER_SESSION'], required: true },
  recordedBy: { type: String, required: true, trim: true, maxlength: 128 },
  recordedAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: String, default: null, maxlength: 128 },
}, { timestamps: false, strict: 'throw' });

const decisionSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 240 },
  description: { type: String, trim: true, maxlength: 4000, default: '' },
  status: { type: String, enum: ['RECORDED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED'], default: 'RECORDED' },
  recordedBy: { type: String, required: true, maxlength: 128 },
  recordedAt: { type: Date, default: Date.now },
  externalPolicyReference: { type: String, trim: true, maxlength: 200, default: null },
}, { timestamps: false, strict: 'throw' });

const actionItemSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 240 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  assignedToRef: { type: String, trim: true, maxlength: 128, default: null },
  dueAt: { type: Date, default: null },
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'], default: 'OPEN' },
  createdBy: { type: String, required: true, maxlength: 128 },
  completedAt: { type: Date, default: null },
  completedBy: { type: String, default: null, maxlength: 128 },
}, { timestamps: true, strict: 'throw' });

const auditTrailSchema = new Schema({
  action: { type: String, required: true, trim: true, maxlength: 100 },
  actorId: { type: String, required: true, trim: true, maxlength: 128 },
  at: { type: Date, default: Date.now },
  requestId: { type: String, maxlength: 128, default: null },
  correlationId: { type: String, maxlength: 128, default: null },
  details: { type: Schema.Types.Mixed, default: {} },
}, { _id: false, strict: 'throw' });

const meetingSchema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100, index: true },
  groupRef: { type: String, trim: true, maxlength: 128, default: null, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
  purpose: { type: String, trim: true, maxlength: 4000, default: '' },
  meetingType: { type: String, enum: ['COMMUNITY', 'SAVINGS_GROUP', 'SACCO', 'COOPERATIVE', 'ASSOCIATION', 'EMPLOYER', 'PENSIONER_GROUP', 'INSURANCE_ORGANIZATION', 'CORPORATE', 'OTHER'], default: 'COMMUNITY', required: true },
  format: { type: String, enum: ['IN_PERSON', 'REMOTE', 'HYBRID'], default: 'IN_PERSON', required: true },
  venue: { type: String, trim: true, maxlength: 300, default: null },
  timeZone: { type: String, trim: true, maxlength: 100, default: 'Africa/Kampala' },
  scheduledStart: { type: Date, default: null, index: true },
  scheduledEnd: { type: Date, default: null },
  status: { type: String, enum: ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], default: 'DRAFT', required: true, index: true },
  cancellationReason: { type: String, trim: true, maxlength: 1000, default: null },
  organizerId: { type: String, required: true, trim: true, immutable: true, maxlength: 128, index: true },
  chairpersonRef: { type: String, trim: true, maxlength: 128, default: null },
  secretaryRef: { type: String, trim: true, maxlength: 128, default: null },
  participants: { type: [participantSchema], default: [] },
  agendaItems: { type: [agendaSchema], default: [] },
  attendance: { type: [attendanceSchema], default: [] },
  minutes: {
    content: { type: String, maxlength: 50000, default: '' },
    status: { type: String, enum: ['EMPTY', 'DRAFT', 'PUBLISHED'], default: 'EMPTY' },
    revision: { type: Number, min: 0, default: 0 },
    updatedBy: { type: String, default: null, maxlength: 128 },
    updatedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: String, default: null, maxlength: 128 },
  },
  decisions: { type: [decisionSchema], default: [] },
  actionItems: { type: [actionItemSchema], default: [] },
  videoRoom: {
    provider: { type: String, enum: ['DAILY', 'NONE'], default: 'NONE' },
    status: { type: String, enum: ['NOT_REQUESTED', 'UNAVAILABLE', 'PROVISIONED', 'FAILED', 'REVOKED'], default: 'NOT_REQUESTED' },
    roomName: { type: String, trim: true, maxlength: 128, default: null },
    roomUrl: { type: String, trim: true, maxlength: 500, default: null },
    provisionedAt: { type: Date, default: null },
    lastErrorCode: { type: String, trim: true, maxlength: 100, default: null },
  },
  revision: { type: Number, min: 1, default: 1, required: true },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  auditTrail: { type: [auditTrailSchema], default: [] },
  appliedOfflineOperationIds: { type: [{ type: String, trim: true, maxlength: 128 }], default: [], select: false },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
  toJSON: {
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

meetingSchema.index({ tenantId: 1, scheduledStart: -1, status: 1 }, { name: 'idx_meetings_tenant_schedule_status' });
meetingSchema.index({ tenantId: 1, organizerId: 1, createdAt: -1 }, { name: 'idx_meetings_tenant_organizer' });
meetingSchema.index({ tenantId: 1, 'participants.identityRef': 1, scheduledStart: -1 }, { name: 'idx_meetings_tenant_participant_schedule' });
meetingSchema.pre('validate', function validateMeeting(next) {
  if (this.scheduledStart && this.scheduledEnd && this.scheduledEnd <= this.scheduledStart) {
    return next(new Error('Scheduled end must be later than scheduled start.'));
  }
  if (['IN_PERSON', 'HYBRID'].includes(this.format) && this.status !== 'DRAFT' && !this.venue) {
    return next(new Error('A venue is required for scheduled in-person or hybrid meetings.'));
  }
  return next();
});

export default mongoose.models.TITechMeeting || mongoose.model('TITechMeeting', meetingSchema, 'titech_meetings');
