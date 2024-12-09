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
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'scudeste';

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

const clientMap = new Map();
wss.on('connection', (ws) => {
    let authenticated = false;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'authenticate' && data.token) {
                const token = data.token;
                const username = jwt.decode(token).username;
                clientMap.set(username, ws);
                authenticated = true;
            }
        } catch (error) {
            console.error('Invalid message format:', message);
        }
    });
    ws.on('close', () => {
        clientMap.forEach((value, key) => {
            if (value === ws) clientMap.delete(key);
        });
    });
});
const broadcast = data =>
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });

const broadcastToUser = (data, username) =>{
    const client = clientMap.get(username);
    if(client && client.readyState === WebSocket.OPEN){
        client.send(JSON.stringify(data));
    }
}

class Book {
    constructor({id, title, author, releaseDate, quantity, isRentable, owner, image = null, lat = null, long =null}) {
        this.id = id;
        this.title = title;
        this.author = author;
        this.releaseDate = releaseDate;
        this.quantity = quantity;
        this.isRentable = isRentable;
        this.owner = owner;
        this.image = image;
        this.lat = lat;
        this.long = long;
    }
}

const authenticateToken = async (ctx, next) => {
    const token = ctx.request.headers['authorization'];

    if (!token) {
        ctx.response.status = 401;
        ctx.response.body = {message: 'Token required'};
        return;
    }

    try {
        console.log("Token: " + token);
        const user = await jwt.verify(token.split(" ")[1], JWT_SECRET);
        const username = user.username;
        console.log("Username found: " + username);
        const statement = db.prepare('SELECT loggedOut FROM Users WHERE username = ?');
        const loggedOut = statement.get(username).loggedOut;
        if (loggedOut === 0) {
            ctx.state.user = user;
            return next();
        } else {
            ctx.response.status = 401;
            ctx.response.body = {message: 'Token is blacklisted'};
        }
    } catch (err) {
        ctx.response.status = 403;
        ctx.response.body = {message: 'Invalid or expired token'};
    }
};
router.get('/books', authenticateToken, ctx => {
    const token = ctx.request.headers['authorization'].split(" ")[1];
    const username = jwt.decode(token).username;

    const statement = db.prepare(
        'SELECT * FROM Books WHERE (owner = ? OR owner IS NULL)'
    );
    const books = statement.all(username);
    ctx.response.body = books;
    ctx.response.status = 200;
});

router.get('/books/:id', authenticateToken, async (ctx) => {
    const token = ctx.request.headers['authorization'].split(" ")[1];
    const username = jwt.decode(token).username;
    const bookId = parseInt(ctx.params.id);

    const statement = db.prepare('SELECT * FROM Books WHERE id = ? AND (owner = ? OR owner IS NULL)');
    const book = statement.get(bookId, username);

    if (book) {
        ctx.response.body = book;
        ctx.response.status = 200;
    } else {
        ctx.response.status = 404; // Not Found
        ctx.response.body = {error: 'Book doesn\'t exist or not authorized'};
    }
});

router.post('/books', authenticateToken, async (ctx) => {
    const {title, author, releaseDate, quantity, isRentable} = ctx.request.body;
    let id;
    const isRentableInt = isRentable ? 1 : 0;
    const token = ctx.request.headers['authorization'];
    const username = jwt.decode(token).username;
    try {
        const statement = db.prepare('INSERT INTO Books(title, author, releaseDate, quantity, isRentable, owner) ' +
            'VALUES (?, ?, ?, ?, ?, ?)');
        const info = statement.run(title, author, releaseDate, quantity, isRentableInt, username);
        id = info.lastInsertRowid;
    } catch (error) {
        ctx.response.body = {message: 'Data is missing!'};
        ctx.response.status = 400 //BAD REQUEST;
    }
    const book = new Book({id, title, author, releaseDate, quantity, isRentable, username})
    ctx.status = 201; //Created
    ctx.response.body = book;
    broadcastToUser({event: 'created', payload: book}, username);
});

router.put('/books', authenticateToken, async (ctx) => {
    const newBook = ctx.request.body;
    const {id, title, releaseDate, quantity, isRentable, owner, author, image, lat, long} = newBook;
    const token = ctx.request.headers['authorization'].split(" ")[1];
    const username = jwt.decode(token).username;
    const statement = db.prepare(
        'UPDATE Books SET title = ?, releaseDate = ?, quantity = ?, isRentable = ?, author = ?, image = ?, lat = ?, long = ? ' +
        'WHERE id = ? AND (owner = ? OR owner IS NULL)'
    );
    const info = statement.run(title, releaseDate, quantity, isRentable, author, image || null, lat || null, long ||null, id, username);

    if (info.changes > 0) {
        ctx.response.body = newBook;
        ctx.response.status = 200; // OK
    } else {
        ctx.response.status = 400; // BAD REQUEST
        ctx.response.body = {error: 'Book doesn\'t exist or not authorized to update'};
    }

    const stat = db.prepare('SELECT * FROM Books WHERE id = ?');
    const book = stat.get(id);
    if (book.owner === null) {
        broadcast({event: 'updated', payload: newBook});
    } else {
        broadcastToUser({event: 'updated', payload: newBook}, username);
    }
});

router.delete('/books/:id', authenticateToken, ctx => {
    const id = parseInt(ctx.request.ctx.params.id);
    const token = ctx.request.headers['authorization'];
    const username = jwt.decode(token).username;
    const statement = db.prepare('DELETE FROM Books WHERE id = ? AND (owner = ? or owner is null)');
    const info = statement.run(id, username);
    if (info.changes > 0) {
        ctx.response.status = 204; //NO CONTENT
        broadcast({event: 'deleted', payload: {id}});
    } else {
        ctx.response.status = 400; //BAD REQUEST
        ctx.response.body = {message: 'Book doesn\'t exist'};
    }
});

router.post('/login', ctx => {
    const {username, password} = ctx.request.body;
    const statement = db.prepare('SELECT 1 FROM Users WHERE username = ? and password = ?');
    const rez = statement.get(username, password);
    if (rez) {
        const payload = {username};
        const token = jwt.sign(payload, JWT_SECRET, {expiresIn: '1d'});
        const statement2 = db.prepare('UPDATE Users SET loggedOut=false WHERE username= ?');
        const info2 = statement2.run(username);
        ctx.response.status = 200;//OK
        ctx.response.body = {token: token};
    } else {
        ctx.response.status = 401; //Unauthorized
        ctx.response.body = {message: 'Username or password incorrect'};
    }
});

router.post('/logout', authenticateToken, ctx => {
    const token = ctx.request.headers['authorization'];
    const username = jwt.decode(token).username;

    const statement = db.prepare('UPDATE Users SET loggedOut = 1 WHERE username = ?');
    const info = statement.run(username);
    if (info.changes > 0) {
        ctx.response.body = {message: "Logged out"};
        ctx.response.status = 200; //OK
    } else {
        ctx.response.body = {message: "Couldn't log out"}
        ctx.response.status = 400;
    }
});

router.post('/checkToken', authenticateToken, ctx => {
    ctx.response.status = 200;
    ctx.response.body = {authenticated: true};
});

app.use(router.routes());
app.use(router.allowedMethods());

const port = 3000;
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
