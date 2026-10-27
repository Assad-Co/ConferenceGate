import assert from 'node:assert/strict';
import test from 'node:test';
import { titleCorroborated } from './conferenceVerification';
test('independent title corroboration rejects unrelated events', () => {
 assert.equal(titleCorroborated('International Geochemistry Energy Symposium', 'Annual Robotics Software Meeting'), false);
});
test('independent title corroboration recognizes substantial matching subjects', () => {
 assert.equal(titleCorroborated('International Geochemistry Energy Symposium', 'Geochemistry Energy Symposium 2027'), true);
});
test('generic conference labels cannot verify an event', () => {
 assert.equal(titleCorroborated('International Annual Conference', 'International Annual Conference'), false);
});
