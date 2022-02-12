const mysql = require('mysql');

const connectionOptions = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

if (process.env.DB_USE_SSL !== undefined && process.env.DB_USE_SSL === 'yes') {
    connectionOptions.ssl = 'Amazon RDS';
}

const connection = mysql.createConnection(connectionOptions);

module.exports = () => {
    return new Promise((resolve, reject) => {
        connection.connect((err) => {
            if (err) {
                reject(err)
                return;
            }
            connection.query(`CREATE TABLE IF NOT EXISTS apartment_info (
  id int(11) AUTO_INCREMENT PRIMARY KEY,
  username varchar(32) NOT NULL,
  chat_id BIGINT NOT NULL,
  apartment_number int UNSIGNED NOT NULL,
    INDEX chat_id (chat_id),
    INDEX apartment_number (apartment_number),  
    UNIQUE INDEX apartment_contact (username, chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
`, (error, results) => {
                if (error) {
                    reject(error)
                    return;
                }
                resolve(connection);
            })

        });
    })
}
