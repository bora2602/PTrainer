# Ptrainer privacy launch checklist

The in-app Privacy Notice is a controlled-pilot draft, not a legal certification. Complete this checklist with qualified Canadian privacy counsel before collecting real trainer or trainee information.

## Required operator decisions

- Record the operator’s full legal name, business address, jurisdiction, and accountable privacy officer.
- Replace `PRIVACY_CONTACT_EMAIL` with a monitored address and document the access/correction/complaint workflow.
- Confirm which federal and provincial privacy laws apply to the business, users, trainers, and launch provinces.
- Determine whether any trainer is a regulated health professional or health information custodian and whether Ptrainer would act as an electronic service provider or agent.
- Define the minimum permitted user age and the parental/guardian consent process for youth.

## Data location and providers

- Select the production database, backup, email, error-monitoring, object-storage, CDN, and payment providers.
- Record every provider’s legal entity, processing purpose, country/region, security commitments, deletion process, and subprocessors.
- Set `DATA_STORAGE_REGION` to the truthful primary storage region and disclose any cross-border processing or support access.
- Sign suitable data-processing/service agreements and confirm encryption in transit, at rest, and in backups.

## Retention and deletion

- Approve exact retention periods for accounts, invitations, reset tokens, relationships, workouts, logs, progress, nutrition, messages, audit events, support records, and backups.
- Implement and test automated expiry/deletion jobs before replacing the pilot retention warning.
- Verify that account deletion handles free-text personal information and backup expiry, not only direct identity fields.
- Document legal holds, fraud/security exceptions, restoration procedures, and proof of deletion.

## Consent and user rights

- Review every collection field for necessity and clearly mark optional sensitive fields.
- Validate the notice and consent experience with trainers, trainees, youth/guardians if applicable, and accessibility users.
- Establish identity verification and response procedures for access, correction, export, withdrawal, relationship revocation, deletion, and complaints.
- Require renewed consent when a material new purpose, disclosure, provider, or notice version requires it.

## Security and incidents

- Complete authorization testing, threat modelling, dependency review, backup restoration, least-privilege access, and production secrets rotation.
- Create a breach-response plan covering containment, investigation, risk-of-significant-harm assessment, records, regulator reporting, user notification, and remediation.
- Train every person with production access and document periodic privacy/security reviews.

## Launch approval

- Replace all pilot placeholders and ensure the public notice matches actual system behaviour.
- Obtain written legal/privacy approval and an accountable business-owner sign-off.
- Run a final data-flow and retention audit against the deployed production environment.
