import mongoose from "mongoose";

const { Schema } = mongoose;

const tenantInvitationSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    maxUses: {
      type: Number,
      required: true,
      min: 1,
      max: 1000,
      default: 1,
    },
    uses: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: "throw",
  }
);

tenantInvitationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "idx_tenant_invitation_expiry_ttl" }
);

const TenantInvitation =
  mongoose.models.TenantInvitation ||
  mongoose.model("TenantInvitation", tenantInvitationSchema);

export default TenantInvitation;
