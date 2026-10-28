import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateConferenceResults, formatConferenceLocation, populatedDetailSections } from '../conferencePresentation';
import type { LiveSearchResult } from '../../api/search';
const result = (overrides: Partial<LiveSearchResult> = {}) => ({title:'IROS 2027',link:'https://example.org/iros/',startDate:'2027-09-27',sections:[],...overrides}) as LiveSearchResult;
test('locations remove repeated comma components without inventing place names',()=>{
 assert.equal(formatConferenceLocation('Al Khobar, Al Khobar, Saudi Arabia'),'Al Khobar, Saudi Arabia');
 assert.equal(formatConferenceLocation('Rome, rome, Italy'),'Rome, Italy');
 assert.equal(formatConferenceLocation(null),'');
});
test('availability flags alone cannot inflate detail coverage',()=>{
 assert.deepEqual(populatedDetailSections(null),[]);
 assert.deepEqual(populatedDetailSections({sectionAvailability:{call_for_papers:'stated',fees_pricing:'stated'}}),['overview']);
 assert.deepEqual(populatedDetailSections({cfpDeadline:'2027-03-19',committee:[{name:'Real committee member'} as any]}),['overview','cfp','committee']);
});
test('duplicate official sources retain richer details and separate editions and paths',()=>{
 const sparse=result();const richer=result({title:'IEEE/RSJ IROS 2027',link:'http://www.example.org/iros',sections:['cfp','agenda']});
 const next=result({startDate:'2028-09-27'});const separate=result({link:'https://example.org/iros/workshop'});
 const deduped=deduplicateConferenceResults([sparse,richer,next,separate]);
 assert.equal(deduped.length,3);assert.equal(deduped[0],richer);
 assert.equal(deduplicateConferenceResults([result({startDate:null,title:'First edition'}),result({startDate:null,title:'Second edition'})]).length,2);
});

test('known IROS official-source aliases collapse and conflicting AACSB attribution is withheld',()=>{
 const aliases=deduplicateConferenceResults([
  result({link:'https://2027.ieee-iros.org/',location:{city:'Florence',country:'Italy'}}),
  result({link:'https://www.ieee-ras.org/event/2027-ieee-rsj-international-conference-on-intelligent-robots-and-systems-iros-70525/',location:{city:'50129 Italy',country:'Italy'},sections:['agenda']}),
 ]);
 assert.equal(aliases.length,1);assert.deepEqual(aliases[0].location,{city:'Florence',country:'Italy'});
 const conflict=result({link:'https://www.aacsb.edu/events/2026/10/cn-2026-october-latin-america-and-caribbean-summit',organization:'AAPG Latin America & Caribbean Region'});
 assert.equal(deduplicateConferenceResults([conflict]).length,0);
 assert.equal(deduplicateConferenceResults([{...conflict,organization:'AACSB'}]).length,1);
});

test('distinct query-selected conferences are never merged',()=>{
 assert.equal(deduplicateConferenceResults([result({link:'https://events.example.org/?id=first'}),result({link:'https://events.example.org/?id=second'})]).length,2);
});
test('distinct same-day workshops sharing an organizer homepage remain visible',()=>{
 const first=result({title:'Workshop on Robotics — NeurIPS 2026',link:'https://neurips.cc/',startDate:'2026-12-11'});
 const second=result({title:'Workshop on Climate — NeurIPS 2026',link:'https://neurips.cc/',startDate:'2026-12-11'});
 assert.equal(deduplicateConferenceResults([first,second,{...first,sections:['agenda']}]).length,2);
});

test('IROS workshop paths remain distinct from the main edition',()=>{
 assert.equal(deduplicateConferenceResults([result({link:'https://2027.ieee-iros.org/'}),result({link:'https://2027.ieee-iros.org/workshops'})]).length,2);
});

test('different conferences on a shared calendar path remain separate even on the same day',()=>{
 const first=result({title:'First conference',link:'https://society.example/events/upcoming',startDate:'2027-03-01',linkIsConferencePage:false});
 const second={...first,title:'Second conference'};
 assert.equal(deduplicateConferenceResults([first,second,{...first,sections:['agenda']}]).length,2);
});
