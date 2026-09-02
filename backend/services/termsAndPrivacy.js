/**
 * Terms and Privacy Service
 * ============================================================================
 * Manages Terms of Service, Privacy Policy, and user acceptance tracking
 */

const mongoose = require('mongoose');

// Mock schema for LegalAcceptance
const LegalAcceptanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  termsVersion: String,
  privacyVersion: String,
  acceptedAt: { type: Date, default: Date.now },
  ipAddress: String,
  userAgent: String,
});

const LegalAcceptance = mongoose.model('LegalAcceptance', LegalAcceptanceSchema);

// Document versions
const CURRENT_VERSIONS = {
  terms: '1.0.0',
  privacy: '1.0.0',
};

// Last updated dates
const LAST_UPDATED = {
  terms: new Date('2026-01-15'),
  privacy: new Date('2026-01-15'),
};

/**
 * Get full Terms of Service document
 */
function getTermsOfService() {
  return {
    title: 'Terms of Service',
    version: CURRENT_VERSIONS.terms,
    effectiveDate: '2026-01-15',
    lastUpdated: LAST_UPDATED.terms,
    content: `
# TERMS OF SERVICE

**Community Savings App - Community Savings Platform**

## 1. ACCEPTANCE OF TERMS

By accessing and using the Community Savings App ("the App"), you accept and agree to be bound by the terms and provision of this agreement.

If you do not agree to abide by the above, please do not use this service.

## 2. USE LICENSE

Permission is granted to temporarily download one copy of the materials (information or software) on the Community Savings App for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:

- Modifying or copying the materials
- Using the materials for any commercial purpose or for any public display
- Attempting to decompile or reverse engineer any software contained on the Community Savings App
- Removing any copyright or other proprietary notations from the materials
- Transferring the materials to another person or "mirroring" the materials on any other server
- Using the materials in any way that infringes upon any trademark, copyright, or other proprietary right
- Downloading materials unless expressly permitted by the App
- Automatically collecting data or content from the App (scraping)
- Accessing restricted or password protected portions of the App without authorization
- Circumventing any security or technological measures employed by the App

## 3. DISCLAIMER OF WARRANTIES

The materials on the Community Savings App are provided on an 'as is' basis. The Community Savings App makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.

Further, the Community Savings App does not warrant or make any representations concerning the accuracy, likely results, or reliability of the use of the materials on the Internet web site associated with such materials, or otherwise relating to such materials or on any sites linked to this site.

## 4. LIMITATIONS OF LIABILITY

In no event shall the Community Savings App or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption,) arising out of the use or inability to use the materials on the Community Savings App, even if the Community Savings App or a Community Savings App authorized representative has been notified orally or in writing of the possibility of such damage.

## 5. ACCURACY OF MATERIALS

The materials appearing on the Community Savings App could include technical, typographical, or photographic errors. The Community Savings App does not warrant that any of the materials on the App are accurate, complete, or current. The Community Savings App may make changes to the materials contained on the App at any time without notice.

## 6. MATERIALS AND CONTENT OWNERSHIP

The Community Savings App does not claim any ownership rights in the text, files, images, photos, video, sounds, musical compositions, artwork, source code, or other materials/information you create using the App ("User Content"). However, by submitting User Content to the App, you grant the Community Savings App a worldwide, non-exclusive, royalty-free license to use, copy, reproduce, process, adapt, modify, publish, transmit, display and distribute such content in any media or medium and for any purpose.

## 7. FINANCIAL TRANSACTIONS & PAYMENT

- All financial transactions conducted through the App are subject to verification and validation
- The App facilitates payments through authorized payment providers (M-Pesa, Stripe, MTN MoMo, Airtel Money)
- Users are responsible for maintaining the confidentiality of payment information
- Transaction fees may apply as disclosed during payment
- All transactions are final once confirmed
- The App is not liable for delays or failures of third-party payment providers

## 8. LOAN AGREEMENTS

For users participating in loan programs:

- All loan terms are clearly displayed before acceptance
- Borrowers agree to repay loans according to agreed schedules
- Late payments may result in penalties as specified in loan terms
- The App is not a lender but a facilitator
- Loan disputes should be resolved through group consensus

## 9. USER RESPONSIBILITIES

You agree to:

- Provide accurate and complete information during registration
- Maintain the confidentiality of your account credentials
- Be responsible for all activities under your account
- Notify us immediately of unauthorized access
- Use the App only for lawful purposes
- Not engage in harassment, abuse, or discriminatory behavior
- Comply with all applicable laws and regulations

## 10. PROHIBITED CONDUCT

You may not:

- Use the App for any illegal or unlawful purpose
- Transmit viruses, malware, or harmful code
- Engage in fraud, phishing, or hacking attempts
- Harass, threaten, or intimidate other users
- Upload illegal, copyrighted, or malicious content
- Attempt to gain unauthorized access to App systems
- Interfere with App operations or security

## 11. LIMITATION OF SUPPORT

The Community Savings App provides support on a best-effort basis. We do not guarantee response times or resolution of all issues. Support is available through:

- Email support
- In-app help center
- FAQ section
- Community forums (where available)

## 12. REVISION OF TERMS

The Community Savings App may revise these terms of service for the App at any time without notice. By using this App, you are agreeing to be bound by the then current version of these terms of service.

## 13. GOVERNING LAW

These terms and conditions are governed by and construed in accordance with the laws of Kenya, and you irrevocably submit to the exclusive jurisdiction of the courts located in Kenya.

## 14. DISPUTE RESOLUTION

Any disputes arising from these terms will be subject to binding arbitration before litigation, except for claims regarding intellectual property rights or unauthorized access to the App.

## 15. SEVERABILITY

If any provision of these terms is found to be invalid or unenforceable, the remaining provisions will continue in full force and effect.

## 16. ENTIRE AGREEMENT

These terms constitute the entire agreement between you and the Community Savings App regarding the use of the App, and supersede all prior negotiations, representations, or agreements, whether written or oral.

## 17. CONTACT INFORMATION

For questions about these terms, please contact:

Community Savings App
Email: legal@communitysavings.app
Support: support@communitysavings.app

---

**Last Updated: January 15, 2026**
**Version: 1.0.0**
    `,
  };
}

/**
 * Get full Privacy Policy document
 */
function getPrivacyPolicy() {
  return {
    title: 'Privacy Policy',
    version: CURRENT_VERSIONS.privacy,
    effectiveDate: '2026-01-15',
    lastUpdated: LAST_UPDATED.privacy,
    content: `
# PRIVACY POLICY

**Community Savings App**

## 1. INTRODUCTION

The Community Savings App ("we", "us", "our", or "Company") operates the Community Savings App platform. This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our App and the choices you have associated with that data.

We use your data to provide and improve the App. By using the App, you agree to the collection and use of information in accordance with this policy.

## 2. DEFINITIONS

- **Personal Data**: Any information relating to an identified or identifiable natural person
- **Processing**: Any operation performed on data such as collection, recording, organization, structuring, storage, adaptation, retrieval, consultation, use, disclosure, erasure, or destruction
- **Controller**: The natural or legal person who determines the purposes and means of processing
- **Processor**: The natural or legal person who processes data on behalf of the controller
- **Data Subject**: The individual to whom personal data relates
- **Consent**: Any freely given, specific, informed and unambiguous indication of the data subject's wishes

## 3. TYPES OF DATA COLLECTED

### 3.1 Personal Information

When you register for an account, we collect:

- Full name
- Email address
- Phone number
- Date of birth
- National ID/Passport number
- Physical address
- Occupation and income information (for loan eligibility)
- Contact person details
- Profile photo/avatar

### 3.2 Financial Information

- Bank account details
- Mobile money account information
- Transaction history
- Contribution amounts and dates
- Loan applications and history
- Payment method information
- Card/account last 4 digits only

### 3.3 Device Information

- Device type and model
- Operating system and version
- Browser type
- Mobile device ID
- IP address
- Device identifiers

### 3.4 Usage Information

- Pages and features accessed
- Time and duration of visits
- Search queries and interactions
- Buttons clicked and features used
- Errors encountered
- File uploads and downloads

### 3.5 Communication Data

- Messages sent in group chats
- Support requests and responses
- Feedback and survey responses
- Email communications
- Call logs (for support)

### 3.6 Location Data

- GPS location (only when explicitly enabled)
- Location derived from IP address
- Geolocation for fraud prevention

## 4. LEGAL BASIS FOR PROCESSING

We process your personal data based on:

- **Consent**: You have given clear consent for processing
- **Contract**: Processing is necessary to perform our contract with you
- **Legal Obligation**: We have a legal obligation to process your data
- **Vital Interests**: Processing is necessary to protect vital interests
- **Public Task**: Processing is necessary for a task in the public interest
- **Legitimate Interests**: Processing is necessary for our legitimate interests

## 5. USE OF DATA

We use the collected data for various purposes:

### 5.1 Service Provision

- Creating and maintaining your account
- Processing transactions
- Sending transactional emails (confirmations, receipts)
- Providing customer support
- Managing group memberships
- Tracking contributions and loans

### 5.2 Communication

- Sending newsletters and updates (with your consent)
- Notifying you of policy changes
- Responding to inquiries
- Sending promotional offers
- Service announcements

### 5.3 Improvement and Analytics

- Analyzing usage patterns to improve features
- Understanding user behavior and preferences
- Conducting research and surveys
- Creating aggregated, non-identifiable data
- Testing new features

### 5.4 Security and Compliance

- Detecting and preventing fraud
- Enforcing terms of service
- Protecting against legal liability
- Complying with legal obligations
- Audit logging and monitoring

### 5.5 Marketing

- Personalizing your experience
- Sending targeted advertisements
- Creating user segments for campaigns
- Measuring campaign effectiveness

## 6. DATA RETENTION

We retain your personal data for as long as necessary to provide services and fulfill the purposes outlined:

- **Account Data**: For the duration of your account and 3 years after closure
- **Transaction Data**: For 7 years for regulatory compliance
- **Communication Data**: For 2 years or as required by law
- **Usage Data**: For 12 months for analytics
- **Location Data**: For 30 days unless extended usage
- **Marketing Data**: Until you opt-out

You can request deletion of your data subject to legal requirements.

## 7. DATA SHARING AND THIRD PARTIES

### 7.1 We May Share Data With

- **Payment Processors**: Stripe, M-Pesa, MTN MoMo, Airtel Money
- **Email Service Providers**: For transactional emails
- **Analytics Providers**: Google Analytics, Mixpanel
- **Cloud Providers**: AWS, Google Cloud (for data storage)
- **Financial Partners**: Licensed lenders and credit unions
- **Legal Authorities**: When required by law
- **Group Members**: Limited data within your savings group
- **Service Providers**: Third-party vendors providing services

### 7.2 Data Protection in Third Parties

- We require all third parties to maintain strict confidentiality
- We implement Data Processing Agreements (DPA)
- We conduct audit of third-party security measures
- Third parties must comply with applicable data protection laws
- We are liable for third-party breaches under our control

### 7.3 International Data Transfers

Data may be transferred to countries outside Kenya where our service providers operate. These transfers:

- Are protected by Standard Contractual Clauses
- Comply with GDPR and local data protection laws
- Maintain equivalent data protection standards
- Include explicit user consent where required

## 8. SECURITY OF DATA

The security of your data is important to us:

- We implement industry-standard encryption (TLS 1.2+)
- Data is encrypted both in transit and at rest
- Access is restricted to authorized personnel
- We conduct regular security audits
- We maintain firewalls and intrusion detection
- We perform penetration testing
- We have incident response procedures
- Passwords are hashed using bcrypt

However, no method of transmission over the Internet is 100% secure. While we strive to protect your personal data, we cannot guarantee its absolute security.

## 9. YOUR RIGHTS

You have the right to:

- **Access**: Request what personal data we hold
- **Rectification**: Correct inaccurate data
- **Erasure**: Request deletion of your data (Right to be Forgotten)
- **Restrict**: Limit how we process your data
- **Portability**: Receive data in portable format
- **Object**: Object to processing for direct marketing
- **Withdraw Consent**: Withdraw previously given consent
- **Lodge Complaint**: File complaints with supervisory authorities

To exercise these rights, contact us at privacy@communitysavings.app

## 10. CHILDREN'S PRIVACY

The App is not intended for children under 18 years old. We do not knowingly collect personal data from children. If we become aware that a child has provided us with personal data, we will delete such information and terminate the child's account.

## 11. COOKIES AND TRACKING TECHNOLOGIES

### 11.1 Cookies

We use cookies for:

- Maintaining your session
- Remembering preferences
- Tracking analytics
- Personalizing content
- Security and fraud prevention

### 11.2 Cookie Management

You can control cookies through your browser settings:

- Accept all cookies
- Block all cookies
- Block third-party cookies
- Delete cookies on exit

Disabling cookies may affect App functionality.

### 11.3 Other Tracking

We may use:

- Web beacons and pixels
- Log files and server logs
- Local storage and SessionStorage
- Fingerprinting technology

## 12. GDPR AND DATA PROTECTION LAWS

For users subject to:

- **GDPR** (EU): You have enhanced rights under GDPR
- **Kenya Data Protection Act**: You have rights under KDPA
- **Other Local Laws**: Applicable local data protection laws apply

Our Data Processing Agreement is available upon request.

## 13. CALIFORNIA PRIVACY RIGHTS (CCPA)

For California residents:

- You have the right to know what personal data is collected
- You have the right to delete personal data
- You have the right to opt-out of the sale of personal data
- We do not sell personal data to third parties
- We do not discriminate based on privacy choices

## 14. MARKETING PREFERENCES

You can manage your marketing preferences:

- Opt-out of email marketing
- Opt-out of push notifications
- Opt-out of SMS messages
- Customize frequency of communications

Manage preferences in Settings > Notifications or click "Unsubscribe" in emails.

## 15. DATA BREACH NOTIFICATION

In the event of a data breach:

- We will notify affected individuals without undue delay
- We will provide information about the breach
- We will include recommended protective steps
- We will report to supervisory authorities where required
- We will maintain incident records

## 16. CHANGES TO THIS POLICY

We may update this privacy policy periodically. We will notify you of significant changes:

- Via email
- Through in-app notification
- By posting the updated policy on the App
- By requiring acceptance of new terms

Your continued use constitutes acceptance of changes.

## 17. POLICY COMPLIANCE

We comply with:

- GDPR (General Data Protection Regulation)
- CCPA (California Consumer Privacy Act)
- Kenya Data Protection Act, 2019
- Industry best practices and standards
- ISO 27001 Information Security Standards

## 18. DATA PROTECTION OFFICER

For data protection inquiries:

- Email: privacy@communitysavings.app
- Address: Community Savings App, Nairobi, Kenya
- Phone: +254 XXX XXX XXX
- Response time: 30 days maximum

## 19. CONTACT INFORMATION

For questions or concerns about this privacy policy:

Community Savings App
Privacy Team
Email: privacy@communitysavings.app
Support: support@communitysavings.app
Postal Address: [Company Address]

## 20. EFFECTIVE DATE

This privacy policy is effective as of January 15, 2026.

---

**Last Updated: January 15, 2026**
**Version: 1.0.0**
**Next Review: January 15, 2027**
    `,
  };
}

/**
 * Get version of document
 */
function getVersion(docType) {
  return CURRENT_VERSIONS[docType] || '1.0.0';
}

/**
 * Get last updated date
 */
function getLastUpdated(docType) {
  return LAST_UPDATED[docType] || new Date();
}

/**
 * Record user's acceptance of terms and privacy
 */
async function recordAcceptance(userId, termsVersion, privacyVersion, ipAddress, userAgent) {
  try {
    const acceptance = new LegalAcceptance({
      userId,
      termsVersion,
      privacyVersion,
      ipAddress,
      userAgent,
    });

    await acceptance.save();
    return acceptance;
  } catch (error) {
    throw new Error(`Failed to record acceptance: ${error.message}`);
  }
}

/**
 * Get user's acceptance status
 */
async function getAcceptanceStatus(userId) {
  try {
    const latestAcceptance = await LegalAcceptance.findOne({ userId }).sort({ acceptedAt: -1 });

    const currentTermsVersion = CURRENT_VERSIONS.terms;
    const currentPrivacyVersion = CURRENT_VERSIONS.privacy;

    if (!latestAcceptance) {
      return {
        hasAccepted: false,
        acceptedTerms: false,
        acceptedPrivacy: false,
        currentTermsVersion,
        currentPrivacyVersion,
        acceptedAt: null,
      };
    }

    const termsUpToDate = latestAcceptance.termsVersion === currentTermsVersion;
    const privacyUpToDate = latestAcceptance.privacyVersion === currentPrivacyVersion;

    return {
      hasAccepted: true,
      acceptedTerms: termsUpToDate,
      acceptedPrivacy: privacyUpToDate,
      currentTermsVersion,
      currentPrivacyVersion,
      acceptedAt: latestAcceptance.acceptedAt,
      acceptedTermsVersion: latestAcceptance.termsVersion,
      acceptedPrivacyVersion: latestAcceptance.privacyVersion,
    };
  } catch (error) {
    throw new Error(`Failed to get acceptance status: ${error.message}`);
  }
}

/**
 * Get changelog of legal document updates
 */
function getChangelog() {
  return [
    {
      version: '1.0.0',
      date: '2026-01-15',
      document: 'both',
      changes: [
        'Initial release',
        'Comprehensive Terms of Service',
        'Complete Privacy Policy',
        'GDPR and CCPA compliance',
        'Data retention policies',
        'User rights documentation',
      ],
    },
  ];
}

module.exports = {
  getTermsOfService,
  getPrivacyPolicy,
  getVersion,
  getLastUpdated,
  recordAcceptance,
  getAcceptanceStatus,
  getChangelog,
  LegalAcceptance,
};
