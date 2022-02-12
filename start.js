require('dotenv').config();
const {handler} = require('./index');
const http = require('http');

const requestListener = function (req, res) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    req.on('end', () => {
        handler({body}, req).then(
            () => res.end('ok'), (error) => {
                console.log(error);
            }
        )

    });
    res.writeHead(200);
}

const server = http.createServer(requestListener);
server.listen(3000);