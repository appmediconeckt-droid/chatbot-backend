import sinon from "sinon";
import AccountDeletionJob from "../../src/models/AccountDeletionJob.js";
// Existing isolated fixtures have no deletion requests. Tests that cover a
// pending request explicitly override this stub; persistence suites use MongoDB.
export const mochaHooks = {
  beforeEach() { this.deletionExists = sinon.stub(AccountDeletionJob, "exists").resolves(null); },
  afterEach() { if (AccountDeletionJob.exists.restore) AccountDeletionJob.exists.restore(); },
};
