const express = require('express');
const router = express.Router();
const policyController = require('../../controllers/policyController');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, validateUUID, schemas } = require('../../middleware/validation');
const { IS_HR_UP } = require('../../config/constants');

// /leave routes must stay above /:id

// GET  /api/v1/policies/leave                  - Leave allocations per leave type
router.get('/leave', authenticate, policyController.getLeavePolicies);

// PUT  /api/v1/policies/leave/:leaveType       - Create/update a leave allocation (HR/Admin)
router.put('/leave/:leaveType', authenticate, authorize(...IS_HR_UP), validate(schemas.upsertLeavePolicy), policyController.upsertLeavePolicy);

// GET  /api/v1/policies                        - Policies with own acknowledgement status (?category&includeInactive)
router.get('/', authenticate, policyController.list);

// POST /api/v1/policies                        - Publish a policy (HR/Admin)
router.post('/', authenticate, authorize(...IS_HR_UP), validate(schemas.createPolicy), policyController.create);

// GET  /api/v1/policies/:id                    - One policy
router.get('/:id', authenticate, validateUUID('id'), policyController.get);

// PUT  /api/v1/policies/:id                    - Update; title/content/effective date bumps the version (HR/Admin)
router.put('/:id', authenticate, authorize(...IS_HR_UP), validateUUID('id'), validate(schemas.updatePolicy), policyController.update);

// DELETE /api/v1/policies/:id                  - Archive (HR/Admin)
router.delete('/:id', authenticate, authorize(...IS_HR_UP), validateUUID('id'), policyController.archive);

// POST /api/v1/policies/:id/acknowledge        - Acknowledge the current version
router.post('/:id/acknowledge', authenticate, validateUUID('id'), policyController.acknowledge);

// GET  /api/v1/policies/:id/acknowledgements   - Who has / hasn't acknowledged (HR/Admin)
router.get('/:id/acknowledgements', authenticate, authorize(...IS_HR_UP), validateUUID('id'), policyController.getAcknowledgements);

module.exports = router;
