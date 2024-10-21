const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const Database = require('better-sqlite3');
const cors = require('koa-cors');
const WebSocket = require('ws');

const db = new Database('books.db', {verbose: console.log});
const app = new Koa();
const server = require('http').createServer(app.callback());
const router = new Router();
const wss = new WebSocket.Server({server});

app.use(bodyParser());
app.use(cors());

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

const broadcast = data =>
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });

class Book {
    constructor({id, title, author, releaseDate, quantity, isRentable}) {
        this.id = id;
        this.title = title;
        this.author = author;
        this.releaseDate = releaseDate;
        this.quantity = quantity;
        this.isRentable = isRentable;
    }
}

router.get('/books', ctx => {
    const statement = db.prepare('SELECT * FROM Books');
    const books = statement.all();
    ctx.response.body = books;
});

router.get('/books/:id', async (ctx) => {
    const bookId = parseInt(ctx.request.ctx.params.id);
    const statement = db.prepare('SELECT * FROM Books WHERE id = ?');
    const book = statement.get(bookId);
    if (book) {
        ctx.response.body = book;
    } else {
        ctx.response.status(404);
        ctx.response.body = {error: 'Book doesn\'t exist'};
    }
});

router.post('/books', async (ctx) => {
    const {title, author, releaseDate, quantity, isRentable} = ctx.request.body;
    let id;
    try {
        const statement = db.prepare('INSERT INTO Books(title, author, releaseDate, quantity, isRentable) ' +
            'VALUES (?, ?, ?, ?, ?)');
        const info = statement.run(title, author, releaseDate, quantity, isRentable);
        id = info.lastInsertedRowid;
    } catch (error) {
        ctx.response.body = {message: 'Data is missing!'};
        ctx.response.status = 400 //BAD REQUEST;
    }
    const book = new Book({id, title, author, releaseDate, quantity, isRentable})
    ctx.status = 201; //Created
    ctx.response.body = book;
    broadcast({event: 'created', payload: {book}});
});

router.put('/books', async (ctx) => {
    const newBook = ctx.request.body;
    const id = newBook.id;
    const statement = db.prepare('UPDATE Books SET title = ?, releaseDate = ?, quantity = ?, isRentable = ?, author = ? WHERE id = ?');
    const info = statement.run(newBook.title, newBook.releaseDate, newBook.quantity, newBook.isRentable, newBook.author, newBook.id);
    if (info.changes > 0) {
        ctx.response.body = newBook;
        ctx.response.status = 200; //OK
    } else {
        ctx.response.status = 400; //BAD REQUEST
        ctx.response.body = {error: 'Book doesn\'t exist'};
    }
    broadcast({event: 'updated', payload: {newBook}});
});

router.delete('/books/:id', ctx => {
    const id = parseInt(ctx.request.ctx.params.id);
    const statement = db.prepare('DELETE FROM Books WHERE id = ?');
    const info = statement.run(id);
    if (info.changes > 0) {
        ctx.response.status = 204; //NO CONTENT
        broadcast({event: 'deleted', payload: {id}});
    } else {
        ctx.response.status = 400; //BAD REQUEST
        ctx.response.body = {message: 'Book doesn\'t exist'};
    }
});

router.put('/login', ctx => {
    const {username, password} = ctx.request.body;
    const statement = db.prepare('SELECT 1 FROM Users WHERE username = ? and password = ?');
    const rez = statement.get(username, password);
    if(rez){
        ctx.response.status = 200;//OK
        ctx.response.body = {message:'Ok login'};
    }else
    {
        ctx.response.status = 401; //Unauthorized
    }
});

app.use(router.routes());
app.use(router.allowedMethods());

const port = 3000;
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
