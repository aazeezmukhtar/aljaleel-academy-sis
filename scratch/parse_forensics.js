// Forensic parsing and verification of Query 4 results
const rawData = `
200|SABI'U  ABDULKARIM|261790|active|10|Kindergarten|10|Kindergarten|17|R 1 B
271|A'ISHA ABDULLAHI|886709|active|10|Kindergarten|10|Kindergarten|16|R 1 A
205|ABUBAKAR  ABUBAKAR|802356|active|10|Kindergarten|10|Kindergarten|17|R 1 B
400|ZAINAB AHMAD IBRAHIM|133861|active|10|Kindergarten|10|Kindergarten|17|R 1 B
336|YUSUF AHMAD YUSUF|784278|active|10|Kindergarten|10|Kindergarten|16|R 1 A
349|AMINA ALIYU|419133|active|10|Kindergarten|10|Kindergarten|16|R 1 A
344|MARYAM ALIYU|519525|active|10|Kindergarten|10|Kindergarten|16|R 1 A
399|SUWAIBA ALIYU|809318|active|10|Kindergarten|10|Kindergarten|17|R 1 B
183|HAUWA'U  ALIYU|633236|active|10|Kindergarten|10|Kindergarten|17|R 1 B
397|AMATURRAHMAN AMIN|632871|active|10|Kindergarten|10|Kindergarten|16|R 1 A
204|AHMAD AMINU ALI|231683|active|10|Kindergarten|10|Kindergarten|17|R 1 B
398|SHEMA'U BASHAR|325107|active|10|Kindergarten|10|Kindergarten|null|null
300|KHADIJA BUHARI|531009|active|10|Kindergarten|10|Kindergarten|16|R 1 A
274|ABDUMANAF FAISAL HARUNA|358142|active|10|Kindergarten|10|Kindergarten|16|R 1 A
193|JA'AFAR  HAMZA|538933|active|10|Kindergarten|10|Kindergarten|17|R 1 B
407|ABDULLAHI IBRAHIM|296142|active|10|Kindergarten|10|Kindergarten|null|null
408|MUHAMMAD ISMA'IL|916183|active|10|Kindergarten|10|Kindergarten|17|R 1 B
191|IBRAHIM  KHAMIS|400748|active|10|Kindergarten|10|Kindergarten|17|R 1 B
311|MUHAMMAD LAWAL MUKHTAR|398633|active|10|Kindergarten|10|Kindergarten|17|R 1 B
172|ASMA'U  MAHMUD|558973|active|10|Kindergarten|10|Kindergarten|17|R 1 B
406|AHMAD MAMMAN|717676|active|10|Kindergarten|10|Kindergarten|null|null
184|NI'IMATULLAH  MUBARAK|291527|active|10|Kindergarten|10|Kindergarten|17|R 1 B
401|RUQAYYA MUHAMMAD|550030|active|10|Kindergarten|10|Kindergarten|17|R 1 B
190|MUHAMMAD MUHAMMAD KABIR|599729|active|10|Kindergarten|10|Kindergarten|17|R 1 B
403|MUSADDEEQ MUKHTAR|462558|active|10|Kindergarten|10|Kindergarten|null|null
312|MUHAMMAD MUSBAHU TUKUR|138638|active|10|Kindergarten|10|Kindergarten|17|R 1 B
198|MUBARAK  MUSTAPHA|215798|active|10|Kindergarten|10|Kindergarten|17|R 1 B
321|RASHIDAT MUZAMMIL ABDULLAHI|877189|active|10|Kindergarten|10|Kindergarten|16|R 1 A
301|KHADIJA RABE UMAR|539340|active|10|Kindergarten|10|Kindergarten|16|R 1 A
402|HAUWA'U SADE|837622|active|10|Kindergarten|10|Kindergarten|17|R 1 B
302|KHADIJA USMAN|929948|active|10|Kindergarten|10|Kindergarten|16|R 1 A
404|SULAIMAN USMAN|190732|active|10|Kindergarten|10|Kindergarten|null|null
405|ABDURRAHMAN USMAN YUSUF|888828|active|10|Kindergarten|10|Kindergarten|null|null
281|AHMAD YAHAYA ADO|569219|active|10|Kindergarten|10|Kindergarten|16|R 1 A
359|AUWAL ZAHARADDEEN|137301|active|10|Kindergarten|10|Kindergarten|17|R 1 B
199|SADIQ ZAYYANU|352892|active|10|Kindergarten|10|Kindergarten|17|R 1 B
277|AHMAD ABDULAZIZ|203874|active|11|Nursery 1|11|Nursery 1|16|R 1 A
270|A'ISHA ABDULHAMID|193989|active|11|Nursery 1|11|Nursery 1|16|R 1 A
223|HALIMATU ABDULHAMID|487477|active|11|Nursery 1|11|Nursery 1|16|R 1 A
216|ABDULLAHI ABUBAKAR|793586|active|11|Nursery 1|11|Nursery 1|null|null
226|NASIR BELLO|338720|active|11|Nursery 1|11|Nursery 1|16|R 1 A
342|FATIMA IBRAHIM|111882|active|28|Primary 2|11|Nursery 1|12|R 2
215|ABDULAZIZ JAMILU|818112|active|11|Nursery 1|11|Nursery 1|null|null
222|FATIMA MUHAMMAD KABIR|989604|active|11|Nursery 1|11|Nursery 1|16|R 1 A
273|ABDULLAHI MUKHTAR|952002|active|11|Nursery 1|11|Nursery 1|16|R 1 A
220|ALIYU SADE|193120|active|11|Nursery 1|11|Nursery 1|null|null
224|HASSANA SALISU|902024|active|11|Nursery 1|11|Nursery 1|null|null
225|HUSSAINA  SALISU|897840|active|11|Nursery 1|11|Nursery 1|null|null
339|ZUHAIRAT SALISU|900854|active|11|Nursery 1|11|Nursery 1|16|R 1 A
227|NASIR YUSUF ADODO|695037|active|11|Nursery 1|11|Nursery 1|16|R 1 A
124|ABDULLAHI  ALIYU|433845|active|28|Primary 2|18|Nursery 2|12|R 2
134|AHMAD  ALIYU|661280|active|28|Primary 2|18|Nursery 2|12|R 2
135|AHMAD  BASHAR|659579|active|28|Primary 2|18|Nursery 2|12|R 2
343|ABDULLAHI IBRAHIM|180363|active|18|Nursery 2|18|Nursery 2|13|F 1 A
149|JANA  KHAMIS|763808|active|28|Primary 2|18|Nursery 2|12|R 2
153|MARDIYYA  MUHAMMAD|561249|active|28|Primary 2|18|Nursery 2|12|R 2
41|SAUBAN  MUSTAPHA ISHAQ|463119|active|18|Nursery 2|18|Nursery 2|13|F 1 A
1|SA'ADATU NASIR|200001|active|28|Primary 2|18|Nursery 2|12|R 2
155|MARYAM  SAGIR|125318|active|28|Primary 2|18|Nursery 2|12|R 2
152|MAIMUNATU  SHAMSU|542112|active|28|Primary 2|18|Nursery 2|12|R 2
355|ALMUSTAPHA ABDULKARIM|220098|active|25|Primary 1|25|Primary 1|null|null
356|ABDULLAHI ABUBAKAR|121583|active|25|Primary 1|25|Primary 1|null|null
156|MUHAMMAD  BASHAR|695918|active|28|Primary 2|25|Primary 1|12|R 2
52|A'ISHA HAMISU|554455|active|25|Primary 1|25|Primary 1|14|F 1 B
42|SHAFA'ATU KHAMIS|408016|active|25|Primary 1|25|Primary 1|13|F 1 A
122|A'ISHA   LAWAL MUKHTAR|263519|active|28|Primary 2|25|Primary 1|12|R 2
142|FATIMA   LAWAL MUKHTAR|809340|active|28|Primary 2|25|Primary 1|12|R 2
354|AMMAR MUHAMMAD|960461|active|25|Primary 1|25|Primary 1|14|F 1 B
45|ZAINAB MUKHTAR|706115|active|25|Primary 1|25|Primary 1|13|F 1 A
357|HAUWA'U SALISU|956402|active|25|Primary 1|25|Primary 1|null|null
59|ALIYU UMAR|266528|active|25|Primary 1|25|Primary 1|14|F 1 B
36|MUHAMMAD YAHAYA|525499|active|25|Primary 1|25|Primary 1|13|F 1 A
65|HAQILU ABBAS|554036|active|14|F 1 B|null|null|14|F 1 B
159|RAHAMA  ABBAS|783263|active|28|Primary 2|null|null|12|R 2
244|KHADIJA ABDULHADI|258634|active|20|F 3 A|null|null|20|F 3 A
419|SULTAN ABDULHAKIM|910758|active|17|R 1 B|null|null|17|R 1 B
109|MARYAM  ABDULLAHI  MAGAJI|991718|active|15|F 2|null|null|15|F 2
8|ABDULHAKIM ABDULLAHI AHMAD|513513|active|13|F 1 A|null|null|13|F 1 A
3|HAFSAT ABDULLAHI MAGAJI|716452|active|28|Primary 2|null|null|12|R 2
391|JA'AFAR ABDULLAHI SANI|215585|active|22|F 4|null|null|22|F 4
389|ABDULLAHI ABDULMALIK|196179|active|22|F 4|null|null|22|F 4
388|ABDURRAHMAN ABDULMALIK|432738|active|22|F 4|null|null|22|F 4
13|ABUBAKAR ABDULMALIK|942307|active|13|F 1 A|null|null|13|F 1 A
140|FATIMA  ABDULMALIK|344368|active|28|Primary 2|null|null|12|R 2
196|UMAR FAROUK ABDULMALIK|868743|active|17|R 1 B|null|null|17|R 1 B
118|SAIFULLAHI ABDULQADIR|701884|active|15|F 2|null|null|15|F 2
19|AHMAD ABDULWAHAB|138896|active|13|F 1 A|null|null|13|F 1 A
126|ABDULMAJID  ABDURRAHMAN|232769|active|28|Primary 2|null|null|12|R 2
128|ABDURRA'UF  ABDURRAHMAN|987342|active|28|Primary 2|null|null|12|R 2
233|ALIYA ABDURRAHMAN|536625|active|20|F 3 A|null|null|20|F 3 A
174|A'ISHA  ABDURRASHID|967114|active|17|R 1 B|null|null|17|R 1 B
132|AHMAD  ABDURRASHID|275058|active|28|Primary 2|null|null|12|R 2
73|SABI'U ABDURRASHID|354292|active|14|F 1 B|null|null|14|F 1 B
74|SAUDAT ABDURRASHID|587819|active|14|F 1 B|null|null|14|F 1 B
27|BUSHRA ABDURRAZAQ|341152|active|13|F 1 A|null|null|13|F 1 A
396|LAWAL ABDUSSALAM|605461|active|22|F 4|null|null|22|F 4
364|MUHAMMAD ABDUSSALAM|841119|active|28|Primary 2|null|null|12|R 2
129|ABUBAKAR  ABUBAKAR|725174|active|28|Primary 2|null|null|12|R 2
133|AHMAD  ABUBAKAR|170318|active|28|Primary 2|null|null|12|R 2
141|FATIMA  ABUBAKAR|833044|active|28|Primary 2|null|null|12|R 2
`;

const lines = rawData.trim().split('\n');
console.log('Total parsed rows:', lines.length);

const grouped = {};
for (const line of lines) {
    const parts = line.split('|');
    const [id, name, adm, status, currId, currName, srcId, srcName, tgtId, tgtName] = parts;
    const key = `${srcName || 'NO_2025_ENROLLMENT'} -> ${currName} (new: ${tgtName})`;
    grouped[key] = (grouped[key] || 0) + 1;
}

console.log('Distribution:');
console.log(JSON.stringify(grouped, null, 2));
