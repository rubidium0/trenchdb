/* 12.18.2022 SUMMARY:
    Known issues:
        - If a query fails, the transaction will still be committed
        - If a transaction fails, the connection will be left in a bad state
    Improvements:
        - Successfully implemented a transaction function
        - Successfully implemented a scalar function
    Possible bugs:
        - The connection is not being closed properly
*/

// The whole code is made by rubidium#0325 and now it's open source.
// Licensed with GNU General Public License v3.0

const mysql = require("mysql");
const MySQLHandler = {};

MySQLHandler.connection = null;
MySQLHandler.queryHistory = [];
MySQLHandler.originalData = {};


MySQLHandler.createConnection = function() {
  this.connection = mysql.createConnection({
    host: "localhost",
    port: 3306,
    user: "root",
    database: "trenches",
  });
  this.connection.connect();
};

MySQLHandler.destroyConnection = function() {
  if (this.connection) {
    this.connection.end();
  }
};

MySQLHandler.isBoolean = function(value) {
  return value === 0 || value === 1;
};

MySQLHandler.executeQuery = function(query, ...values) {
  return new Promise((resolve, reject) => {
    this.connection.query(query, values, (error, results) => {
      if (error) {
        reject(error);
      } else if (results.length === 1 && this.isBoolean(results[0])) {
        this.queryHistory.unshift({ query, values, results: results[0] === 1 });
        if (this.queryHistory.length > 10) {
          this.queryHistory.pop();
        }
        resolve(results[0] === 1);
      } else {
        this.queryHistory.unshift({ query, values, results });
        if (this.queryHistory.length > 10) {
          this.queryHistory.pop();
        }
        resolve(results);
      }
    });
  });
};

MySQLHandler.scalar = function(query, ...values) {
    return new Promise((resolve, reject) => {
      this.connection.query(query, values, (error, results) => {
        if (error) {
          reject(error);
        } else if (results.length === 1) {
          const result = results[0];
          const key = Object.keys(result)[0];
          resolve(result[key]);
        } else {
          resolve();
        }
      });
    });
  };
  
MySQLHandler.transaction = function(queries) {
    return new Promise((resolve, reject) => {
      this.connection.beginTransaction((error) => {
        if (error) {
          reject(error);
        } else {
          const promises = queries.map((query) => {
            return new Promise((resolve, reject) => {
              this.connection.query(query.sql, query.values, (error) => {
                if (error) {
                  reject(error);
                } else {
                  resolve();
                }
              });
            });
          });
          Promise.all(promises).then(() => {
            this.connection.commit((error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          }).catch((error) => {
            this.connection.rollback(() => {
              reject(error);
            });
          });
        }
      });
    });
};

MySQLHandler.rollback = function() {
    const queries = this.queryHistory.filter((entry) => {
      return entry.query.startsWith("UPDATE");
    }).slice(0, 10);
    queries.reverse();
    return this.transaction(queries.map((entry) => {
      return {
        sql: entry.query.replace("UPDATE", "SELECT * INTO MySQLHandler.originalData FROM"),
        values: entry.values,
      };
    })).then(() => {
      return this.transaction(queries.map((entry) => {
        return {
          sql: entry.query.replace("UPDATE", "UPDATE MySQLHandler.originalData SET"),
          values: entry.values,
        };
      }));
    });
};

MySQLHandler.getQueryHistory = function() {
  return this.queryHistory;
};

MySQLHandler.escape = function(value) {
  return this.connection.escape(value);
};

MySQLHandler.select = function(table, columns, where) {
  let query = `SELECT ${columns.join(", ")} FROM ${table}`;
  if (where) {
    const whereClause = Object.keys(where).map((key) => {
      return `${key} = ${this.escape(where[key])}`;
    }).join(" AND ");
    query += ` WHERE ${whereClause}`;
  }
  return this.executeQuery(query);
};

MySQLHandler.insert = function(table, data) {
  const columnNames = Object.keys(data);
  const values = columnNames.map((column) => {
    return this.escape(data[column]);
  });
  const query = `INSERT INTO ${table} (${columnNames.join(", ")}) VALUES (${values.join(", ")})`;
  return this.executeQuery(query);
};

MySQLHandler.update = function(table, data, where) {
  let query = `UPDATE ${table} SET `;
  const setClause = Object.keys(data).map((key) => {
    return `${key} = ${this.escape(data[key])}`;
  }).join(", ");
  query += setClause;
  if (where) {
    const whereClause = Object.keys(where).map((key) => {
      return `${key} = ${this.escape(where[key])}`;
    }).join(" AND ");
    query += ` WHERE ${whereClause}`;
  }
  return this.executeQuery(query);
};

MySQLHandler.encryptValues = function(data) {
  const encryptedData = {};
  Object.keys(data).forEach((key) => {
    encryptedData[key] = `PASSWORD(${this.escape(data[key])})`;
  });
  return encryptedData;
};

global.exports('executeQuery', (query, ...values) => MySQLHandler.executeQuery(query, ...values))
global.exports('transaction', (queries) => MySQLHandler.transaction(queries))
global.exports('scalar', (query, ...values) => MySQLHandler.scalar(query, ...values))
global.exports('rollback', () => MySQLHandler.rollback())
global.exports('getQueryHistory', () => MySQLHandler.getQueryHistory())
