// Analysis of the exact 12 students affected
const affected = [
  { id: 342, name: 'FATIMA IBRAHIM', adm: '111882', preId: 11, preClass: 'Nursery 1', currId: 28, currClass: 'Primary 2' },
  { id: 124, name: 'ABDULLAHI ALIYU', adm: '433845', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 134, name: 'AHMAD ALIYU', adm: '661280', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 135, name: 'AHMAD BASHAR', adm: '659579', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 149, name: 'JANA KHAMIS', adm: '763808', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 153, name: 'MARDIYYA MUHAMMAD', adm: '561249', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 1, name: "SA'ADATU NASIR", adm: '200001', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 155, name: 'MARYAM SAGIR', adm: '125318', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 152, name: 'MAIMUNATU SHAMSU', adm: '542112', preId: 18, preClass: 'Nursery 2', currId: 28, currClass: 'Primary 2' },
  { id: 156, name: 'MUHAMMAD BASHAR', adm: '695918', preId: 25, preClass: 'Primary 1', currId: 28, currClass: 'Primary 2' },
  { id: 122, name: "A'ISHA LAWAL MUKHTAR", adm: '263519', preId: 25, preClass: 'Primary 1', currId: 28, currClass: 'Primary 2' },
  { id: 142, name: 'FATIMA LAWAL MUKHTAR', adm: '809340', preId: 25, preClass: 'Primary 1', currId: 28, currClass: 'Primary 2' }
];

console.log('Total affected students:', affected.length);
console.log('List of student IDs:', affected.map(a => a.id).join(', '));
