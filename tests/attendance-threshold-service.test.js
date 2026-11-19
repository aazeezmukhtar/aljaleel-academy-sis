'use strict';

const assert=require('assert');
let setting=null;
const fakeDb={get:async(sql,params)=>({value:setting})};
const dbPath=require.resolve('../utils/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
const service=require('../services/attendanceThresholdService');

(async()=>{
 assert.equal(await service.getSchoolThreshold(1),75);
 setting='82.5';
 assert.equal(await service.getSchoolThreshold(1),82.5);
 assert.equal(await service.getSchoolThreshold(1,'60'),60,'An explicit report override should take precedence.');
 assert.equal(await service.getSchoolThreshold(1,''),82.5,'An empty override should use the school setting.');
 setting='invalid';
 assert.equal(await service.getSchoolThreshold(1),75,'Invalid legacy setting should safely fall back to 75.');
 for(const value of [-1,100.1,'abc',null]){
  assert.throws(()=>service.validateThreshold(value));
 }
 assert.equal(service.validateThreshold('0'),0);
 assert.equal(service.validateThreshold('100'),100);
 console.log('[attendance-threshold] shared school default, explicit override, fallback and range validation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
