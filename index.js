const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const Database = require('better-sqlite3');

const db = new Database('books.db', {verbose: console.log});
const app = new Koa();
const router = new Router();

app.use(bodyParser());

app.use(async (ctx, next) => {
    const start = new Date();
    await next();
    const ms = new Date() - start;
    console.log(`${ctx.method} ${ctx.url} ${ctx.response.status} - ${ms}ms`);
});

app.use(async (ctx, next) => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await next();
});

app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.response.body = {message: err.message || 'Unexpected error'};
        ctx.response.status = 500;
    }
});

class Book {
    constructor({id, title, author, releaseDate, quantity, isRentable}) {
        this.id = id;
        this.title = title;
        this.author = author;
        this.releaseDate = releaseDate;
        this.quantity = quantity;
        this.isAvailable = isRentable;
    }
}

const books = [];

router.get('/books', ctx => {
    const statement = db.prepare('SELECT * FROM Books');
    const books = statement.all();
    ctx.response.body = books;
});

router.get('/books/:id', async (ctx) => {
    const bookId = parseInt(ctx.request.params.id);
    const statement = db.prepare('SELECT * FROM Books WHERE id = ?');
    const book = statement.get(bookId);
    if (book) {
        ctx.response.body = book;
    } else {
        ctx.resposne.status(404);
        ctx.response.body = {error:'Book not found'};
    }
});

router.post('/books', async (ctx) =>{
   const {title, author, releaseDate, quantity, isRentable} = ctx.request.body;
   const statement = db.prepare('INSERT INTO Books(title, author, releaseDate, quantity, isRentable) ' +
       'VALUES (?, ?, ?, ?, ?)');
   const info = statement.run(title, author, releaseDate, quantity, isRentable);
   ctx.status = 201; //Created
});