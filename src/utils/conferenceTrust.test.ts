import assert from 'node:assert/strict';
import test from 'node:test';
import { conferenceTrustSignals, conferenceMatchReasons } from './conferenceTrust';
test('information score never claims independent verification', () => {
 const signals = conferenceTrustSignals({title:'Geochemistry Conference',link:'https://example.org',organization:'Society',startDate:'2027-05-11',description:'Reservoir science'});
 assert.equal(signals.score,5);
 assert.equal(signals.independentlyVerified,false);
});
test('missing organizer and invalid URL are transparently identified', () => {
 const signals = conferenceTrustSignals({title:'Meeting',link:'javascript:alert(1)'});
 assert.ok(signals.missing.includes('Organizer'));
 assert.ok(signals.missing.includes('HTTPS event link'));
});
test('topic match reasons are explainable and limited to subject fields', () => {
 assert.deepEqual(conferenceMatchReasons({title:'Geochemistry Symposium',category:'Energy'},'geochemistry energy finance'),['geochemistry','energy']);
});
