require('dotenv').config();
const { Telegraf } = require('telegraf');
const mysqlDb = require('./mysql');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, prettyPrint } = format;
require('winston-daily-rotate-file');
const http = require("http");

function isPositiveInteger(str) {
    const n = Math.floor(Number(str));
    return n !== Infinity && String(n) === str && n > 0;
}

const transport = new transports.DailyRotateFile({
    filename: 'logs/application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d'
});

const logger = createLogger({
    format: combine(
        timestamp(),
        prettyPrint()
    ),
    transports: [
        transport
    ]
});


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

const GENERAL_ERROR_MSG = 'Соррян, что-то пошло не так😔';
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const BATCH_MESSAGES_SEND_DELAY_MS = 2000;

mysqlDb()
    .then(db => {
        let batchSendingInProcess = false;
        // @TODO add commands pool instead
        bot.use((ctx, next) => {
            // Shouldn't respond while batch is sending.
            if (batchSendingInProcess) {
                return;
            }
            return next();
        })

        bot.command('setapt', async (ctx) => {
            let aptNumber;
            if (ctx.state.command.args.length === 1) {
                aptNumber = ctx.state.command.args[0];
                if (!isPositiveInteger(aptNumber)) {
                    ctx.reply(`Номер квартиры должен быть числом. Желательно целым и больше нуля.☝️`);
                    return;
                }
            } else {
                ctx.reply(`Ну и как мне понять, в какой квартире ты живешь?🙄`);
                return;
            }
            if (ctx.update.message === undefined) {
                logger.error('setapt: message object is absent in ctx:');
                logger.error(JSON.parse(JSON.stringify(ctx)));
                ctx.reply(`У меня ощущение, будто меня как-то неправильно используют🤔`);
                return;
            }
            const chatId = ctx.update.message.chat.id;
            let username = null;
            let userId;
            if (ctx.update.message.from !== undefined) {
                userId = ctx.update.message.from.id;
                if (ctx.update.message.from.username !== undefined) {
                    username = ctx.update.message.from.username;
                }
            } else {
                logger.error('setapt: cannot find sender user. ctx:');
                logger.error(JSON.parse(JSON.stringify(ctx)));
                ctx.reply(`Ой, а кто это у нас такой скрытный здесь?🤡Даже не понять, кто-ты! (ошибка в определении юзера)`);
                return;
            }

            let id = null;
            try {
                id = await new Promise((resolve, reject) => {
                    db.query(`SELECT id FROM apartment_info WHERE chat_id = ? AND user_id = ?`, [chatId, userId], (error, results) => {
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
                logger.error('setapt: error on attempt to find existing record:');
                logger.error(JSON.parse(JSON.stringify(err)));
                ctx.reply(GENERAL_ERROR_MSG);
                return;
            }

            if (id === null) {
                try {
                    await new Promise((resolve, reject) => {
                        db.query(`INSERT INTO apartment_info (user_id, username, chat_id, apartment_number) VALUES (?, ?, ?, ?)`, [userId, username, chatId, aptNumber], (error, results) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve(true);
                        });
                    });
                } catch (err) {
                    logger.error('setapt: error on attempt to insert record:');
                    logger.error(JSON.parse(JSON.stringify(err)));
                    ctx.reply(GENERAL_ERROR_MSG);
                    return;
                }
            } else {
                try {
                    await new Promise((resolve, reject) => {
                        db.query(`UPDATE apartment_info SET apartment_number = ?, username = ? WHERE id = ?`, [aptNumber, username, id], (error, results) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve(true);
                        })
                    });
                } catch (err) {
                    logger.error('setapt: error on attempt to update existing record:');
                    logger.error(JSON.parse(JSON.stringify(err)));
                    ctx.reply(GENERAL_ERROR_MSG);
                    return;
                }
            }
            ctx.reply(`Понял-принял👍`);
        })

        bot.command('aptcontacts', async (ctx) => {
            let aptNumber;
            if (ctx.state.command.args.length === 1) {
                aptNumber = ctx.state.command.args[0];
                if (!isPositiveInteger(aptNumber)) {
                    ctx.reply(`Номер квартиры должен быть числом. Желательно целым и больше нуля.☝️`);
                    return;
                }
            } else {
                ctx.reply(`Назови номер квартиры, иначе чуда не случится🌈`);
                return;
            }
            const chatId = ctx.update.message.chat.id;

            let contacts = [];
            try {
                contacts = await new Promise((resolve, reject) => {
                    db.query(`SELECT user_id, username FROM apartment_info WHERE chat_id = ? AND apartment_number = ?`, [chatId, aptNumber], (error, results) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(results);
                    });
                });
            } catch (err) {
                logger.error('aptcontacts: error on attempt to find existing record:');
                logger.error(JSON.parse(JSON.stringify(err)));
                ctx.reply(GENERAL_ERROR_MSG);
            }
            if (contacts.length > 0) {
                ctx.reply(renderContacts(contacts), { parse_mode: 'MarkdownV2' });
            } else {
                ctx.reply("Здесь пока никто не живет. Но это не точно.🤓");
            }
        })

        bot.command('aptslist', async (ctx) => {
            if (ctx.update.message === undefined) {
                logger.error('aptslist: message object is absent in ctx:');
                logger.error(JSON.parse(JSON.stringify(ctx)));
                ctx.reply(`У меня ощущение, будто меня как-то неправильно используют🤔`);
                return;
            }
            let userId;
            if (ctx.update.message.from !== undefined) {
                userId = ctx.update.message.from.id;
            } else {
                logger.error('aptslist: cannot find sender user. ctx:');
                logger.error(JSON.parse(JSON.stringify(ctx)));
                ctx.reply(`Ой, а кто это у нас такой скрытный здесь?🤡Даже не понять, кто-ты! (ошибка в определении юзера)`);
                return;
            }

            const chatId = ctx.update.message.chat.id;
            let contacts = [];
            try {
                contacts = await new Promise((resolve, reject) => {
                    db.query(`SELECT * FROM apartment_info WHERE chat_id = ? ORDER BY apartment_number`, [chatId], (error, results) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(results);
                    });
                });
            } catch (err) {
                logger.error('aptslist: error on attempt to find existing record:');
                logger.error(JSON.parse(JSON.stringify(err)));
                ctx.reply(GENERAL_ERROR_MSG);
                return;
            }

            const msgs = buildAptListMessages(contacts);
            let sendMessagesChain = Promise.resolve();
            batchSendingInProcess = true;
            for (let msg of msgs) {
                sendMessagesChain = sendMessagesChain.then(() => {
                    ctx.telegram.sendMessage(ctx.update.message.from.id, msg, {parse_mode: 'MarkdownV2'});
                    return new Promise(resolve => {
                        setTimeout(() => {
                            resolve(true);
                        }, BATCH_MESSAGES_SEND_DELAY_MS);
                    })
                })
            }
            sendMessagesChain
                .catch(err => {
                    logger.error('aptslist: error on attempt to send messages:');
                    logger.error(JSON.parse(JSON.stringify(err)));
                    setTimeout(() => {
                        ctx.telegram.sendMessage(ctx.update.message.from.id, GENERAL_ERROR_MSG);
                        }, BATCH_MESSAGES_SEND_DELAY_MS
                    );

                })
                .finally(() => batchSendingInProcess = false);
        });

        bot.command('delme', async (ctx) => {
            if (ctx.update.message === undefined) {
                logger.error('delme: message object is absent in ctx:');
                logger.error(JSON.parse(JSON.stringify(ctx)));
                ctx.reply(`У меня ощущение, будто меня как-то неправильно используют🤔`);
                return;
            }
            let userId;
            if (ctx.update.message.from !== undefined) {
                userId = ctx.update.message.from.id;
            } else {
                logger.error('delme: cannot find sender user. ctx:');
                logger.error(JSON.parse(JSON.stringify(ctx)));
                ctx.reply(`Ой, а кто это у нас такой скрытный здесь?🤡Даже не понять, кто-ты! (ошибка в определении юзера)`);
                return;
            }
            const chatId = ctx.update.message.chat.id;

            try {
                await new Promise((resolve, reject) => {
                    db.query(`DELETE FROM apartment_info WHERE chat_id = ? AND user_id = ?`, [chatId, userId], (error, results) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(true);
                    });
                });
            } catch (err) {
                logger.error('aptslist: error on attempt to find existing record:');
                logger.error(JSON.parse(JSON.stringify(err)));
                ctx.reply(GENERAL_ERROR_MSG);
                return;
            }
            ctx.reply(`Пока-пока🥲`);
        });

        const helpText = `Запомни две команды. Всего лишь две.
        /setapt *номер квартиры* - расскажешь всем, в какой квартире живешь
        /aptcontacts *номер квартиры* - узнаешь, кто живет в этой квартире
Понятное дело, что в одной квартире может проживать несколько человек. Но никто не может проживать в двух квартирах сразу. Поэтому, выбирай свою квартиру с умом🤓 
Повторная команда /setapt *номер квартиры* всегда перезапишет предыдущий номер.
Еще пара вспомогательных команд.
        /aptslist - покажет все квартиры и тех, кто в них живет. Ответ пришлет в личке. Чтобы это заработало напиши что-нибудь боту первым. Будь смелее, не стесняйся!💪
        /delme - удалит запись о тебе, если ты решил переехать или просто покинуть чат`;
        bot.start((ctx) => ctx.reply(helpText));
        bot.help((ctx) => ctx.reply(helpText))
        bot.on('text', (ctx) => {
            ctx.reply(`Не знаю, что ты имеешь ввиду🤷`);
        });
    })
    .catch(error => logger.error(JSON.parse(JSON.stringify(error))))

const renderContact = (contact) => {
    if (contact.username !== null) {
        return `[@${contact.username}](tg://user?id=${contact.user_id})`.replace(/_/g, "\\_");
    } else {
        return `[без юзернейма](tg://user?id=${contact.user_id})`
    }
}

const renderContacts = (contacts) => contacts.map((contact) => renderContact(contact)).join(', ');

const buildAptListMessages = (contacts) => {
    return buildTgMessages(buildAptListLines(contacts));
}

const buildAptListLines = (contacts) => {
    if (contacts.length === 0) {
        return [`Здесь никто не живет🤷`]
    }

    const contactsByAptsNumber = {};
    contacts.reduce((contactsByAptsNumber, contact) => {
        if (contactsByAptsNumber[contact.apartment_number] === undefined) {
            contactsByAptsNumber[contact.apartment_number] = [];
        }
        contactsByAptsNumber[contact.apartment_number].push(contact);
        return contactsByAptsNumber;
    }, contactsByAptsNumber)

    const aptMessageLines = [];
    for (let contact of contacts) {
        if (contactsByAptsNumber[contact.apartment_number] !== undefined) {
            aptMessageLines.push(`кв ${contact.apartment_number} : ${renderContacts(contactsByAptsNumber[contact.apartment_number])}`);
            delete contactsByAptsNumber[contact.apartment_number];
        }
    }
    return aptMessageLines;
}

const buildTgMessages = (lines) => {
    const messages = [];
    let currentMessageLength = 0;
    let messageRowStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        // +1 because of \n symbol
        if (currentMessageLength + lines[i].length + 1 > TELEGRAM_MAX_MESSAGE_LENGTH) {
            messages.push(lines.slice(messageRowStartIndex, i).join(`\n`));
            messageRowStartIndex = i;
            currentMessageLength = 0;
        }
        currentMessageLength += lines[i].length + 1;
    }
    messages.push(lines.slice(messageRowStartIndex).join(`\n`));
    return messages;
}

const requestListener = function (req, res) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    req.on('end', async () => {
        let message = null;
        try {
            message = JSON.parse(body);
        } catch (err) {
            logger.error('Error on parse request body:');
            logger.error(JSON.parse(JSON.stringify(err)));
            res.end('ok')
            return;
        }
        try {
            await bot.handleUpdate(message);
        } catch (err) {
            logger.error('Error on handling request message: ');
            logger.error(JSON.parse(JSON.stringify(err)));
        }
        res.end('ok')
    });
    res.writeHead(200);
}

const server = http.createServer(requestListener);
server.listen(3000, () => logger.info('Server is listening on port 3000'));