const fs = require('node:fs');

const books = [
  'Genesis',
  'Exodus',
  'Leviticus',
  'Numbers',
  'Deuteronomy',
  'Joshua',
  'Judges',
  'Ruth',
  '1 Samuel',
  '2 Samuel',
  '1 Kings',
  '2 Kings',
  '1 Chronicles',
  '2 Chronicles',
  'Ezra',
  'Nehemiah',
  'Esther',
  'Job',
  'Psalms',
  'Proverbs',
  'Ecclesiastes',
  'Songs of Solomon',
  'Isaiah',
  'Jeremiah',
  'Lamentations',
  'Ezekiel',
  'Daniel',
  'Hosea',
  'Joel',
  'Amos',
  'Obadiah',
  'Jonah',
  'Micah',
  'Nahum',
  'Habakkuk',
  'Zephaniah',
  'Haggai',
  'Zechariah',
  'Malachi',
  'Matthew',
  'Mark',
  'Luke',
  'John',
  'Acts',
  'Romans',
  '1 Corinthians',
  '2 Corinthians',
  'Galatians',
  'Ephesians',
  'Philippians',
  'Colossians',
  '1 Thessalonians',
  '2 Thessalonians',
  '1 Timothy',
  '2 Timothy',
  'Titus',
  'Philemon',
  'Hebrews',
  'James',
  '1 Peter',
  '2 Peter',
  '1 John',
  '2 John',
  '3 John',
  'Jude',
  'Revelation',
]

fs.readFile("./public/bibles/nkjv.json", function(err, buf) {
  const obj = JSON.parse(buf);
  const newObj = {
    books: []
  };
  for(let i = 0; i < obj.books.length; i++) {
    const book = obj.books[i];
    const newBook = {
      name: books[i],
      index: i,
      chapters: []
    }
    for (let j = 0; j < book.chapters.length; j++) {
      newBook.chapters.push({
        name: (j + 1).toString(),
        index: j,
        verses: []
      })

      for (let k = 0; k < book.chapters[j].verses.length; k++) {
        let verse = book.chapters[j].verses[k];
       
        newBook.chapters[j].verses.push({
          ...verse,
          text: verse.text.replace(/[\[\]]/g, '')
        })
      }
    }
    newObj.books.push(newBook);
  }

  fs.writeFile("./public/bibles/nkjv.json", JSON.stringify(newObj), function(err) {
    if(err) {
      return console.log(err);
    }
    console.log("The file was saved!");
  });
});