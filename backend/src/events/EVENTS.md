# Event Catalog

> Generated from `src/events/contracts` by `npm run events:catalog` - do not edit by hand.

## Envelope

Every message on every topic is wrapped in the same envelope (envelope version 1). Only `data` differs per event.

```json
{
  "eventId": "uuid - unique per event, use it for idempotency",
  "eventType": "WFH_APPROVED",
  "eventVersion": 1,
  "envelopeVersion": 1,
  "occurredAt": "2026-09-25T10:15:00.000Z",
  "source": "smartworkforce-backend",
  "organizationId": "uuid of the tenant",
  "data": {}
}
```

Kafka headers `event-type`, `event-version` and `event-id` repeat the envelope fields so consumers can filter without parsing the body. The message **key** is the field listed under each event (e.g. `userId`), so all events for one employee land on the same partition, in order.

## Versioning rules

- **Non-breaking** (same `eventVersion`): adding an optional field.
- **Breaking** (new `eventVersion`): removing or renaming a field, changing its type, or making it required. Add a new definition with `version + 1` and keep the old one in the contracts so messages already on the topic still validate.
- Producers always emit the latest version.
- Consumers must ignore fields they don't know, and skip (with a log line) versions they don't support.
- Payloads carry ids, dates and enums only - no names, emails or other personal data.

## Topics

| Topic | Events |
|---|---|
| `smartai.attendance.events` | [ATTENDANCE_CHECKED_IN](#attendance_checked_in), [ATTENDANCE_CHECKED_OUT](#attendance_checked_out) |
| `smartai.leave.events` | [LEAVE_APPLIED](#leave_applied), [LEAVE_APPROVED](#leave_approved), [LEAVE_REJECTED](#leave_rejected) |
| `smartai.wfh.events` | [WFH_APPLIED](#wfh_applied), [WFH_APPROVED](#wfh_approved), [WFH_REJECTED](#wfh_rejected) |
| `smartai.regularization.events` | [REGULARIZATION_REQUESTED](#regularization_requested), [REGULARIZATION_APPROVED](#regularization_approved), [REGULARIZATION_REJECTED](#regularization_rejected), [REGULARIZATION_CANCELLED](#regularization_cancelled) |
| `smartai.announcement.events` | [ANNOUNCEMENT_CREATED](#announcement_created) |
| `smartai.policy.events` | [POLICY_PUBLISHED](#policy_published), [POLICY_UPDATED](#policy_updated), [POLICY_ARCHIVED](#policy_archived) |
| `smartai.employee.events` | [EMPLOYEE_JOINED](#employee_joined), [EMPLOYEE_BIRTHDAY](#employee_birthday) |
| `smartai.hiring.events` | [JOB_OPENING_POSTED](#job_opening_posted) |
| `smartai.report.events` | [REPORT_REQUESTED](#report_requested) |

## `smartai.attendance.events`

### ATTENDANCE_CHECKED_IN

An employee checked in for the day.

- **Version:** 1
- **Key:** `userId`
- **Producer:** AttendanceService.checkIn

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `attendanceLogId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |
| `attendanceType` | `PRESENT` \| `LATE` \| `ABSENT` \| `HALF_DAY` \| `WORK_FROM_HOME` | yes |
| `lateMinutes` | integer | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "attendanceLogId": "b8a3f0c2-1d4e-4f6a-8b2c-3e5d7f9a1b20",
  "date": "2026-09-25",
  "attendanceType": "LATE",
  "lateMinutes": 22
}
```

### ATTENDANCE_CHECKED_OUT

An employee checked out - the day now has a full working-hours record.

- **Version:** 1
- **Key:** `userId`
- **Producer:** AttendanceService.checkOut

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `attendanceLogId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |
| `workingMinutes` | integer | yes |
| `earlyLeaveMinutes` | integer | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "attendanceLogId": "b8a3f0c2-1d4e-4f6a-8b2c-3e5d7f9a1b20",
  "date": "2026-09-25",
  "workingMinutes": 512,
  "earlyLeaveMinutes": 0
}
```

## `smartai.leave.events`

### LEAVE_APPLIED

An employee applied for leave; the request is PENDING.

- **Version:** 1
- **Key:** `userId`
- **Producer:** LeaveService.applyLeave

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `leaveRequestId` | uuid | yes |
| `leaveType` | `ANNUAL` \| `SICK` \| `PERSONAL` \| `MATERNITY` \| `PATERNITY` \| `EMERGENCY` \| `UNPAID` \| `COMPENSATORY` \| `BEREAVEMENT` | yes |
| `startDate` | date (YYYY-MM-DD) | yes |
| `endDate` | date (YYYY-MM-DD) | yes |
| `dayCount` | number | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "leaveRequestId": "2d7e9f10-4b3a-4c5d-8e6f-7a8b9c0d1e2f",
  "leaveType": "ANNUAL",
  "startDate": "2026-10-06",
  "endDate": "2026-10-07",
  "dayCount": 2
}
```

### LEAVE_APPROVED

A manager/HR approved a leave request.

- **Version:** 1
- **Key:** `userId`
- **Producer:** LeaveService.approveLeave

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `leaveRequestId` | uuid | yes |
| `leaveType` | `ANNUAL` \| `SICK` \| `PERSONAL` \| `MATERNITY` \| `PATERNITY` \| `EMERGENCY` \| `UNPAID` \| `COMPENSATORY` \| `BEREAVEMENT` | yes |
| `startDate` | date (YYYY-MM-DD) | yes |
| `endDate` | date (YYYY-MM-DD) | yes |
| `approvedBy` | uuid | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "leaveRequestId": "2d7e9f10-4b3a-4c5d-8e6f-7a8b9c0d1e2f",
  "leaveType": "ANNUAL",
  "startDate": "2026-10-06",
  "endDate": "2026-10-07",
  "approvedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

### LEAVE_REJECTED

A manager/HR rejected a leave request.

- **Version:** 1
- **Key:** `userId`
- **Producer:** LeaveService.rejectLeave

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `leaveRequestId` | uuid | yes |
| `leaveType` | `ANNUAL` \| `SICK` \| `PERSONAL` \| `MATERNITY` \| `PATERNITY` \| `EMERGENCY` \| `UNPAID` \| `COMPENSATORY` \| `BEREAVEMENT` | yes |
| `startDate` | date (YYYY-MM-DD) | yes |
| `endDate` | date (YYYY-MM-DD) | yes |
| `rejectedBy` | uuid | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "leaveRequestId": "2d7e9f10-4b3a-4c5d-8e6f-7a8b9c0d1e2f",
  "leaveType": "ANNUAL",
  "startDate": "2026-10-06",
  "endDate": "2026-10-07",
  "rejectedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

## `smartai.wfh.events`

### WFH_APPLIED

An employee requested work from home; the request is PENDING.

- **Version:** 1
- **Key:** `userId`
- **Producer:** WfhService.applyWfh

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `wfhRequestId` | uuid | yes |
| `startDate` | date (YYYY-MM-DD) | yes |
| `endDate` | date (YYYY-MM-DD) | yes |
| `isHalfDay` | boolean | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "wfhRequestId": "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  "startDate": "2026-09-29",
  "endDate": "2026-09-29",
  "isHalfDay": false
}
```

### WFH_APPROVED

A WFH request was approved; the covered days are now WORK_FROM_HOME on the attendance log.

- **Version:** 1
- **Key:** `userId`
- **Producer:** WfhService.approveWfh

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `wfhRequestId` | uuid | yes |
| `startDate` | date (YYYY-MM-DD) | yes |
| `endDate` | date (YYYY-MM-DD) | yes |
| `approvedBy` | uuid | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "wfhRequestId": "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  "startDate": "2026-09-29",
  "endDate": "2026-09-29",
  "approvedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

### WFH_REJECTED

A WFH request was rejected.

- **Version:** 1
- **Key:** `userId`
- **Producer:** WfhService.rejectWfh

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `wfhRequestId` | uuid | yes |
| `startDate` | date (YYYY-MM-DD) | yes |
| `endDate` | date (YYYY-MM-DD) | yes |
| `rejectedBy` | uuid | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "wfhRequestId": "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  "startDate": "2026-09-29",
  "endDate": "2026-09-29",
  "rejectedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

## `smartai.regularization.events`

### REGULARIZATION_REQUESTED

An employee asked to correct a past attendance day.

- **Version:** 1
- **Key:** `userId`
- **Producer:** RegularizationService.applyRegularization

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `regularizationRequestId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |
| `requestType` | `MISSED_CHECK_IN` \| `MISSED_CHECK_OUT` \| `WRONG_TIME` \| `MARK_PRESENT` | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "regularizationRequestId": "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
  "date": "2026-09-23",
  "requestType": "MISSED_CHECK_OUT"
}
```

### REGULARIZATION_APPROVED

A correction was approved and the attendance log for that day was rewritten. Carries the corrected values so attendance consumers can update without re-reading the database.

- **Version:** 1
- **Key:** `userId`
- **Producer:** RegularizationService.approveRegularization

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `regularizationRequestId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |
| `approvedBy` | uuid | yes |
| `attendanceLogId` | uuid | yes |
| `checkInTime` | time (HH:MM:SS) | yes |
| `checkOutTime` | time (HH:MM:SS) \| null | yes |
| `attendanceType` | `PRESENT` \| `LATE` \| `ABSENT` \| `HALF_DAY` \| `WORK_FROM_HOME` | yes |
| `workingMinutes` | integer \| null | yes |
| `lateMinutes` | integer | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "regularizationRequestId": "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
  "date": "2026-09-23",
  "approvedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "attendanceLogId": "b8a3f0c2-1d4e-4f6a-8b2c-3e5d7f9a1b20",
  "checkInTime": "09:40:00",
  "checkOutTime": "18:10:00",
  "attendanceType": "LATE",
  "workingMinutes": 510,
  "lateMinutes": 40
}
```

### REGULARIZATION_REJECTED

A correction request was rejected; attendance is unchanged.

- **Version:** 1
- **Key:** `userId`
- **Producer:** RegularizationService.rejectRegularization

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `regularizationRequestId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |
| `rejectedBy` | uuid | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "regularizationRequestId": "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
  "date": "2026-09-23",
  "rejectedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

### REGULARIZATION_CANCELLED

The employee withdrew their own pending correction request.

- **Version:** 1
- **Key:** `userId`
- **Producer:** RegularizationService.cancelRegularization

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `regularizationRequestId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |

Example `data`:

```json
{
  "userId": "6f1c2b1e-7a52-4d0e-9d52-0c8a6b1f2e11",
  "regularizationRequestId": "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
  "date": "2026-09-23"
}
```

## `smartai.announcement.events`

### ANNOUNCEMENT_CREATED

HR/Admin posted an announcement to the whole organization.

- **Version:** 1
- **Key:** `announcementId`
- **Producer:** AnnouncementService.create

| Field | Type | Required |
|---|---|---|
| `announcementId` | uuid | yes |
| `title` | string | yes |
| `category` | `GENERAL` \| `POLICY` \| `FESTIVAL` \| `ACHIEVEMENT` | yes |
| `isPinned` | boolean | yes |
| `createdBy` | uuid | yes |

Example `data`:

```json
{
  "announcementId": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  "title": "Office closed on Friday",
  "category": "GENERAL",
  "isPinned": true,
  "createdBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

## `smartai.policy.events`

### POLICY_PUBLISHED

A new company policy was published (version 1).

- **Version:** 1
- **Key:** `policyId`
- **Producer:** PolicyService.createPolicy

| Field | Type | Required |
|---|---|---|
| `policyId` | uuid | yes |
| `category` | `LEAVE` \| `ATTENDANCE` \| `WFH` \| `CODE_OF_CONDUCT` \| `IT_SECURITY` \| `HR` \| `OTHER` | yes |
| `policyVersion` | integer | yes |
| `effectiveDate` | date (YYYY-MM-DD) | yes |
| `requiresAcknowledgement` | boolean | yes |
| `publishedBy` | uuid | yes |

Example `data`:

```json
{
  "policyId": "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
  "category": "WFH",
  "policyVersion": 1,
  "effectiveDate": "2026-10-01",
  "requiresAcknowledgement": true,
  "publishedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

### POLICY_UPDATED

A policy was edited. contentChanged=true means a new policyVersion that employees must acknowledge again.

- **Version:** 1
- **Key:** `policyId`
- **Producer:** PolicyService.updatePolicy

| Field | Type | Required |
|---|---|---|
| `policyId` | uuid | yes |
| `policyVersion` | integer | yes |
| `previousPolicyVersion` | integer | yes |
| `contentChanged` | boolean | yes |
| `isActive` | boolean | yes |
| `updatedBy` | uuid | yes |

Example `data`:

```json
{
  "policyId": "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
  "policyVersion": 2,
  "previousPolicyVersion": 1,
  "contentChanged": true,
  "isActive": true,
  "updatedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

### POLICY_ARCHIVED

A policy was archived and is no longer shown to employees.

- **Version:** 1
- **Key:** `policyId`
- **Producer:** PolicyService.archivePolicy

| Field | Type | Required |
|---|---|---|
| `policyId` | uuid | yes |
| `archivedBy` | uuid | yes |

Example `data`:

```json
{
  "policyId": "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
  "archivedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

## `smartai.employee.events`

### EMPLOYEE_JOINED

HR/Admin added a new employee to the organization.

- **Version:** 1
- **Key:** `userId`
- **Producer:** UserService.createUser

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `role` | `EMPLOYEE` \| `MANAGER` \| `HR` \| `ADMIN` | yes |
| `department` | string \| null | yes |
| `managerId` | uuid \| null | yes |
| `hireDate` | date (YYYY-MM-DD) | yes |
| `createdBy` | uuid | yes |

Example `data`:

```json
{
  "userId": "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  "role": "EMPLOYEE",
  "department": "Engineering",
  "managerId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "hireDate": "2026-09-25",
  "createdBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

### EMPLOYEE_BIRTHDAY

It's an employee's birthday today. Emitted once per employee per day by a scheduled worker.

- **Version:** 1
- **Key:** `userId`
- **Producer:** workers/jobs/birthdayJob.js (hourly, once per org per local day)

| Field | Type | Required |
|---|---|---|
| `userId` | uuid | yes |
| `date` | date (YYYY-MM-DD) | yes |

Example `data`:

```json
{
  "userId": "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  "date": "2026-09-25"
}
```

## `smartai.hiring.events`

### JOB_OPENING_POSTED

HR posted a job opening. The notification worker tells every employee so they can refer candidates.

- **Version:** 1
- **Key:** `jobOpeningId`
- **Producer:** HiringService.createJob

| Field | Type | Required |
|---|---|---|
| `jobOpeningId` | uuid | yes |
| `title` | string | yes |
| `department` | string \| null | yes |
| `employmentType` | `FULL_TIME` \| `PART_TIME` \| `CONTRACT` \| `INTERN` | yes |
| `openings` | integer | yes |
| `postedBy` | uuid | yes |

Example `data`:

```json
{
  "jobOpeningId": "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a",
  "title": "Backend Engineer",
  "department": "Engineering",
  "employmentType": "FULL_TIME",
  "openings": 2,
  "postedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```

## `smartai.report.events`

### REPORT_REQUESTED

A workforce report was requested (by a manager/HR, or by the monthly schedule). The report worker generates it and notifies the requester.

- **Version:** 1
- **Key:** `reportId`
- **Producer:** ReportService.requestReport / ReportService.scheduleMonthlyReports

| Field | Type | Required |
|---|---|---|
| `reportId` | uuid | yes |
| `reportType` | `attendance-summary` \| `leave-summary` | yes |
| `periodStart` | date (YYYY-MM-DD) | yes |
| `periodEnd` | date (YYYY-MM-DD) | yes |
| `requestedBy` | uuid \| null | yes |

Example `data`:

```json
{
  "reportId": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "reportType": "attendance-summary",
  "periodStart": "2026-09-01",
  "periodEnd": "2026-09-30",
  "requestedBy": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
}
```
