'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '..', 'views', 'attendance', 'take.ejs');
const template = fs.readFileSync(templatePath, 'utf8');
ejs.compile(template, { filename: templatePath });
console.log('[attendance-register-ui] attendance page EJS template compiled successfully.');
