"use strict";

/**
 * Wraps a Jest lifecycle-hook registration before E2E spec modules load.
 * Every nested lifecycle callback revalidates ownership immediately before it
 * can execute a deleteMany/flush setup or cleanup. Callback-style hooks remain
 * supported so this wrapper does not silently alter Jest's hook contract.
 */
function createOwnershipGuardedHook(registerHook, verifyOwnership) {
  return (callback, timeout) => {
    if (typeof callback !== "function") return registerHook(callback, timeout);

    const guarded = callback.length > 0
      ? (done) => {
        Promise.resolve()
          .then(() => verifyOwnership())
          .then(() => callback(done))
          .catch(done);
      }
      : async () => {
        await verifyOwnership();
        return callback();
      };

    return timeout === undefined ? registerHook(guarded) : registerHook(guarded, timeout);
  };
}

module.exports = {
  createOwnershipGuardedAfterAll: createOwnershipGuardedHook,
  createOwnershipGuardedHook
};
