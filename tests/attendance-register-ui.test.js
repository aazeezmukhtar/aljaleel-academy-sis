'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '..', 'views', 'attendance', 'take.ejs');
const template = fs.readFileSync(templatePath, 'utf8');
ejs.compile(template, { filename: templatePath });
const responsibilityPath = path.join(__dirname, '..', 'views', 'attendance', 'responsibilities.ejs');
ejs.compile(fs.readFileSync(responsibilityPath, 'utf8'), { filename: responsibilityPath });
console.log('[attendance-register-ui] attendance page and responsibility management EJS templates compiled successfully.');
