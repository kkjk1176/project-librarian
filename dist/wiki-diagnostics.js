"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staleReviewAgeDays = void 0;
exports.staleReviewAge = staleReviewAge;
exports.staleReviewAgeDays = 30;
function dateOnlyMillis(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const millis = Date.parse(`${value}T00:00:00Z`);
    return Number.isNaN(millis) ? null : millis;
}
function staleReviewAge(updated, currentDate) {
    const updatedMillis = dateOnlyMillis(updated);
    const currentMillis = dateOnlyMillis(currentDate);
    if (updatedMillis === null || currentMillis === null)
        return null;
    const ageDays = Math.floor((currentMillis - updatedMillis) / 86_400_000);
    return ageDays > exports.staleReviewAgeDays ? ageDays : null;
}
