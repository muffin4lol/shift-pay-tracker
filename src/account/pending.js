// Durable, identity-scoped retry queue for profile/preferences. Versions remain the
// server versions until acknowledged, so a stale offline edit cannot overwrite another device.
export function accountQueue(storage,userId){const key=`shiftpay-account-pending:${userId}`;return {
 read(){return JSON.parse(storage.getItem(key)||'{}');},write(value){storage.setItem(key,JSON.stringify(value));},clear(){storage.removeItem(key);}
};}
