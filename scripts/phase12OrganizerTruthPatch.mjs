import fs from 'node:fs';

const appPath='src/App.tsx';
let app=fs.readFileSync(appPath,'utf8');
const strictVenue="if (!title || !location?.city?.trim() || !location?.country?.trim() || !location?.venue?.trim() || !dates?.start || !dates?.end || !newConfData.format) {";
const realisticVenue="if (!title || !location?.city?.trim() || !location?.country?.trim() || !dates?.start || !dates?.end || !newConfData.format) {";
if(!app.includes(strictVenue)) throw new Error('strict venue guard not found');
app=app.replace(strictVenue,realisticVenue).replace(
  "throw new Error('Conference title, city, country, venue, dates and format are required before publishing.');",
  "throw new Error('Conference title, city, country, dates and format are required before publishing.');"
);
fs.writeFileSync(appPath,app);

const orgPath='src/components/OrganizerDashboard.tsx';
let org=fs.readFileSync(orgPath,'utf8');
const wizardStart=org.indexOf('const handleWizardSubmit');
if(wizardStart<0) throw new Error('wizard handler not found');
const wizardEnd=org.indexOf('const handleBroadcast',wizardStart);
if(wizardEnd<0) throw new Error('wizard end not found');
let block=org.slice(wizardStart,wizardEnd);
if(!block.includes("cfpStatus: 'Open',")) throw new Error('wizard fabricated CFP status not found');
block=block.replace("cfpStatus: 'Open',","cfpStatus: 'Closed',");
block=block.replace(
  "    } catch {\n      setWizardPublished(false);\n    }",
  "    } catch (error) {\n      setWizardPublished(false);\n      showToast({\n        type: 'info',\n        title: 'Conference not published',\n        message: error instanceof Error ? error.message : 'Review the conference details and try again.',\n      });\n    }"
);
org=org.slice(0,wizardStart)+block+org.slice(wizardEnd);
fs.writeFileSync(orgPath,org);
console.log('[phase12-organizer-truth] venue can remain unannounced, CFP no longer defaults open, and publish errors are visible');
