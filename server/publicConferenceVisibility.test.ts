import assert from 'node:assert/strict';
import test from 'node:test';
import {isPublicConference} from './publicConferenceVisibility';
test('explicit acceptance fixtures are excluded while real test-related conferences remain public',()=>{
 assert.equal(isPublicConference({title:'ConferenceGate Synthetic Launch Acceptance (test only)'}),false);
 assert.equal(isPublicConference({title:'QA Test Only',description:'Automated acceptance only'}),false);
 assert.equal(isPublicConference({title:'International Software Testing Conference'}),true);
 assert.equal(isPublicConference({title:'Clinical test only symposium',description:'Research meeting'}),true);
});

test('blank and non-string conference titles are not publicly listed', () => {
 assert.equal(isPublicConference({title: ''}), false);
 assert.equal(isPublicConference({title: '   '}), false);
 assert.equal(isPublicConference({title: null}), false);
 assert.equal(isPublicConference({title: 123}), false);
 assert.equal(isPublicConference({title: 'International Geochemistry Congress'}), true);
});
