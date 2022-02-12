const { Telegraf } = require('telegraf');
const mysqlDb = require('./mysql');

function isPositiveInteger(str) {
    const n = Math.floor(Number(str));
    return n !== Infinity && String(n) === str && n >= 0;
}


const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use((ctx, next) => {
    if (ctx.updateType === 'message' && ctx.update.message.text !== undefined) {
        const text = ctx.update.message.text.toLowerCase();
        if (text.startsWith('/')) {
            const match = text.match(/^\/([^\s]+)\s?(.+)?/);
            let args = [];
            let command;
            if (match !== null) {
                if (match[1]) {
                    command = match[1];
                }
                if (match[2]) {
                    args = match[2].split(' ');
                }
            }

            ctx.state.command = {
                raw: text,
                command,
                args,
            };
        }
    }
    return next();
});

mysqlDb()
    .then(db => {
        bot.command('setapt', async (ctx) => {
            let aptNumber;
            if (ctx.state.command.args.length > 0) {
                aptNumber = ctx.state.command.args[0];
                if (!isPositiveInteger(aptNumber)) {
                    ctx.reply(`Apartment number is incorrect`);
                    return;
                }
            } else {
                ctx.reply(`Please provide apartment number`);
                return;
            }
            if (ctx.update.message === undefined) {
                ctx.reply(`Bot is used in wrong context`);
                return;
            }
            const chatId = ctx.update.message.chat.id;
            let username;
            if (ctx.update.message.from === undefined || ctx.update.message.from.username === undefined) {
                ctx.reply(`Sorry bro, I cannot get your username`);
                return;
            } else {
                username = ctx.update.message.from.username;
            }

            let id = null;
            try {
                id = await new Promise((resolve, reject) => {
                    db.query(`SELECT id FROM apartment_info WHERE chat_id = ? AND username = ?`, [chatId, username], (error, results) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        if (results.length > 0) {
                            resolve(results[0].id);
                        } else {
                            resolve(null);
                        }
                    });
                });
            } catch (err) {
                console.log('Error on attempt to find existing record', JSON.parse(JSON.stringify(err)));
                ctx.reply(`Sorry bro, something went wrong:(`);
                return;
            }

            if (id === null) {
                try {
                    await new Promise((resolve, reject) => {
                        db.query(`INSERT INTO apartment_info (username, chat_id, apartment_number) VALUES (?, ?, ?)`, [username, chatId, aptNumber], (error, results) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve(true);
                        });
                    });
                } catch (err) {
                    console.log('Error on attempt to insert record', JSON.parse(JSON.stringify(err)));
                    ctx.reply(`Sorry bro, something went wrong:(`);
                    return;
                }
            } else {
                try {
                    await new Promise((resolve, reject) => {
                        db.query(`UPDATE apartment_info SET apartment_number = ? WHERE id = ?`, [aptNumber, id], (error, results) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve(true);
                        })
                    });
                } catch (err) {
                    console.log('Error on attempt to update existing record', JSON.parse(JSON.stringify(err)));
                    ctx.reply(`Sorry bro, something went wrong:(`);
                    return;
                }
            }
            ctx.reply(`Got it!`);
        })
        bot.command('aptcontacts', async (ctx) => {
            let aptNumber;
            if (ctx.state.command.args.length > 0) {
                aptNumber = ctx.state.command.args[0];
                if (!isPositiveInteger(aptNumber)) {
                    ctx.reply(`Apartment number is incorrect`);
                    return;
                }
            } else {
                ctx.reply(`Please provide apartment number`);
                return;
            }
            const chatId = ctx.update.message.chat.id;

            try {
                const contacts = await new Promise((resolve, reject) => {
                    db.query(`SELECT username FROM apartment_info WHERE chat_id = ? AND apartment_number = ?`, [chatId, aptNumber], (error, results) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(results);
                    });
                });
                if (contacts.length > 0) {
                    ctx.reply(contacts.map((contact) => `@${contact.username}`).join(', '));
                } else {
                    ctx.reply("Nobody lives here:)");
                }

            } catch (err) {
                console.log('Error on attempt to find existing record', JSON.parse(JSON.stringify(err)));
                ctx.reply(`Sorry bro, something went wrong:(`);
            }
        })
        bot.start((ctx) => ctx.reply(`Hello. \nMy name Serverless Hello Teleram Bot \nI'm working on Cloud Function in the Yandex.Cloud.`))
        bot.help((ctx) => ctx.reply(`Hello, ${ctx.message.from.username}.\nI can say Hello and nothing more`))
        bot.on('text', (ctx) => {
            console.log('here');
            ctx.reply(`test hadnler2`);


        });
    })
    .catch(error => console.log(error))

module.exports.handler = async function (event, context) {
    console.log(event.body);
    try {
        const message = JSON.parse(event.body);
        await bot.handleUpdate(message);
    } catch (err) {
        console.log('Error on parse request body', JSON.parse(JSON.stringify(err)));
    }

    return {
        statusCode: 200,
        body: 'Ok',
    };
};