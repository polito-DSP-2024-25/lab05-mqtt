'use strict';

const Review = require('../components/review');
const db = require('../components/db');
var constants = require('../utils/constants.js');
var WSMessage = require('../components/ws_message.js');
var WebSocket = require('../components/websocket');
const mqtt = require('../components/mqtt');
const MQTTFilmMessage = require('../components/mqtt_film_message.js');

/**
 * Retrieve the reviews of the film with ID filmId
 * 
 * Input: 
 * - req: the request of the user
 * Output:
 * - list of the reviews
 * 
 **/
 exports.getFilmReviews = function(req) {
  return new Promise((resolve, reject) => {
      var sql = "SELECT r.filmId as fid, r.reviewerId as rid, completed, reviewDate, rating, review, c.total_rows FROM reviews r, (SELECT count(*) total_rows FROM reviews l WHERE l.filmId = ? ) c WHERE  r.filmId = ? ";
      var params = getPagination(req);
      if (params.length != 2) sql = sql + " LIMIT ?,?";
      db.all(sql, params, (err, rows) => {
          if (err) {
              reject(err);
          } else {
              let reviews = rows.map((row) => createReview(row));
              resolve(reviews);
          }
      });
  });
}

/**
 * Retrieve the number of reviews of the film with ID filmId
 * 
 * Input: 
* - filmId: the ID of the film whose reviews need to be retrieved
 * Output:
 * - total number of reviews of the film with ID filmId
 * 
 **/
 exports.getFilmReviewsTotal = function(filmId) {
  return new Promise((resolve, reject) => {
      var sqlNumOfReviews = "SELECT count(*) total FROM reviews WHERE filmId = ? ";
      db.get(sqlNumOfReviews, [filmId], (err, size) => {
          if (err) {
              reject(err);
          } else {
              resolve(size.total);
          }
      });
  });
}



/**
 * Retrieve the review of the film having filmId as ID and issued to user with reviewerId as ID
 *
 * Input: 
 * - filmId: the ID of the film whose review needs to be retrieved
 * - reviewerId: the ID ot the reviewer
 * Output:
 * - the requested review
 * 
 **/
 exports.getSingleReview = function(filmId, reviewerId) {
  return new Promise((resolve, reject) => {
      const sql = "SELECT filmId as fid, reviewerId as rid, completed, reviewDate, rating, review FROM reviews WHERE filmId = ? AND reviewerId = ?";
      db.all(sql, [filmId, reviewerId], (err, rows) => {
          if (err)
              reject(err);
          else if (rows.length === 0)
              reject(404);
          else {
              var review = createReview(rows[0]);
              resolve(review);
          }
      });
  });
}


/**
 * Delete a review invitation
 *
 * Input: 
 * - filmId: ID of the film
 * - reviewerId: ID of the reviewer
 * - owner : ID of user who wants to remove the review
 * Output:
 * - no response expected for this operation
 * 
 **/
 exports.deleteSingleReview = function(filmId,reviewerId,owner) {
  return new Promise((resolve, reject) => {
      const sql1 = "SELECT f.owner, r.completed FROM films f, reviews r WHERE f.id = r.filmId AND f.id = ? AND r.reviewerId = ?";
      db.all(sql1, [filmId, reviewerId], (err, rows) => {
          if (err)
              reject(err);
          else if (rows.length === 0)
              reject(404);
          else if(owner != rows[0].owner) {
              reject("403");
          }
          else if(rows[0].completed == 1) {
              reject("409");
          }
          else {
              const sql2 = 'DELETE FROM reviews WHERE filmId = ? AND reviewerId = ?';
              db.run(sql2, [filmId, reviewerId], (err) => {
                  if (err)
                      reject(err);
                  else
                      resolve(null);
              })
          }
      });
  });

}



/**
 * Issue a film review to a user
 *
 *
 * Input: 
 * - reviewerId : ID of the film reviewer
 * - filmId: ID of the film 
 * - owner: ID of the user who wants to issue the review
 * Output:
 * - no response expected for this operation
 * 
 **/
 exports.issueFilmReview = function(invitations,owner) {
  return new Promise((resolve, reject) => {
      const sql1 = "SELECT owner, private FROM films WHERE id = ?";
      db.all(sql1, [invitations[0].filmId], (err, rows) => {
          if (err){
                reject(err);
          }
          else if (rows.length === 0){
              reject(404);
          }
          else if(owner != rows[0].owner) {
              reject(403);
          } else if(rows[0].private == 1) {
              reject(404);
          }
          else {
            var sql2 = 'SELECT * FROM users' ;
            var invitedUsers = [];
            for (var i = 0; i < invitations.length; i++) {
                console.log(invitations[i]);
                if(i == 0) sql2 += ' WHERE (id = ?';
                else sql2 += ' OR id = ?'
                invitedUsers[i] = invitations[i].reviewerId;
            }
            sql2 += ') AND id NOT IN (SELECT reviewerId FROM reviews WHERE filmId = ';
            sql2 += invitations[0].filmId;
            sql2 += ")";
            db.all(sql2, invitedUsers, async function(err, rows) {
                if (err) {
                    reject(err);
                } 
                else if (rows.length !== invitations.length){
                    reject(409);
                }
                else {
                    const sql3 = 'INSERT INTO reviews(filmId, reviewerId, completed) VALUES(?,?,0)';
                    var finalResult = [];
                    for (var i = 0; i < invitations.length; i++) {
                        var singleResult;
                        try {
                            singleResult = await issueSingleReview(sql3, invitations[i].filmId, invitations[i].reviewerId);
                            finalResult[i] = singleResult;
                        } catch (error) {
                            reject ('Error in the creation of the review data structure');
                            break;
                        }
                    }

                    if(finalResult.length !== 0){
                        resolve(finalResult);
                    }        
                }
            }); 
          }
      });
  });
}

const issueSingleReview = function(sql3, filmId, reviewerId){
    return new Promise((resolve, reject) => {
        db.run(sql3, [filmId, reviewerId], function(err) {
            if (err) {
                reject('500');
            } else {
                var createdReview = new Review(filmId, reviewerId, false);
                resolve(createdReview);
            }
        });
    })
}

/**
 * Complete and update a review
 *
 * Input:
 * - review: review object (with only the needed properties)
 * - filmID: the ID of the film to be reviewed
 * - reviewerId: the ID of the reviewer
 * Output:
 * - no response expected for this operation
 * 
 **/
 exports.updateSingleReview = function(review, filmId, reviewerId) {
  return new Promise((resolve, reject) => {

      const sql1 = "SELECT * FROM reviews WHERE filmId = ? AND reviewerId = ?";
      db.all(sql1, [filmId, reviewerId], (err, rows) => {
          if (err)
              reject(err);
          else if (rows.length === 0)
              reject(404);
          else if(reviewerId != rows[0].reviewerId) {
              reject(403);
          }
          else {
            var sql2 = 'UPDATE reviews SET completed = ?';
            var parameters = [review.completed];
            if(review.reviewDate != undefined){
              sql2 = sql2.concat(', reviewDate = ?');
              parameters.push(review.reviewDate);
            } 
            if(review.rating != undefined){
                sql2 = sql2.concat(', rating = ?');
                parameters.push(review.rating);
            } 
            if(review.review != undefined){
                sql2 = sql2.concat(', review = ?');
                parameters.push(review.review);
            } 
            sql2 = sql2.concat(' WHERE filmId = ? AND reviewerId = ?');
            parameters.push(filmId);
            parameters.push(reviewerId);

            db.run(sql2, parameters, function(err) {
              if (err) {
              reject(err);
              } else {
              resolve(null);
            }
           })
          }
      });
  });
}

/**
 * Select a film as the active film
 *
 * Input: 
 * - userId: ID of the user who wants to select the task
 * - filmId: ID of the film to be selected
 * Output:
 * - no response expected for this operation
 * 
 **/
exports.selectFilm = function selectFilm(userId, filmId) {
    return new Promise((resolve, reject) => {

        db.serialize(function() {  

            db.run('BEGIN TRANSACTION;');
            const sql1 = 'SELECT f.id FROM films as f WHERE f.id = ? AND f.private = 0';
            db.all(sql1, [filmId], function(err, check) {
                if (err) {
                    db.run('ROLLBACK;')
                    reject(err);
                } 
                else if (check.length == 0){
                    db.run('ROLLBACK;')
                    reject(409);
                } 
                else {
                    const sql2 = 'SELECT f.id FROM reviews as r, films as f WHERE r.reviewerId = ? AND r.filmId = f.id AND r.active = 1';
                    db.all(sql2, [userId], function(err, rows1) {
                        if (err) {
                            db.run('ROLLBACK;')
                            reject(err);
                        } else {
                            var deselected = null;
                            if(rows1.length !== 0) deselected = rows1[0].id;
                            const sql3 = 'SELECT u.name, f.title FROM reviews as r, users as u, films as f WHERE r.reviewerId = ? AND r.filmId = ? AND r.reviewerId = u.id AND r.filmId = f.id';
                            db.all(sql3, [userId, filmId], function(err, rows2) {
                                if (err) {
                                    db.run('ROLLBACK;')
                                    reject(err);
                                } else {
                                    const sql4 = 'UPDATE reviews SET active = 0 WHERE reviewerId = ?';
                                    db.run(sql4, [userId], function(err) {
                                        if (err) {
                                            db.run('ROLLBACK;')
                                            reject(err);
                                        } else {
                                            const sql5 = 'UPDATE reviews SET active = 1 WHERE reviewerId = ? AND filmId = ? AND NOT EXISTS (SELECT * FROM reviews WHERE reviewerId <> ? AND filmId = ? AND active = 1)';
                                            db.run(sql5, [userId, filmId, userId, filmId], function(err) {
                                                if (err) {
                                                    db.run('ROLLBACK;')
                                                    reject(err);
                                                } else if (this.changes == 0) {
                                                    db.run('ROLLBACK;')
                                                    reject(403);
                                                } else {
                                                            db.run('COMMIT TRANSACTION');

                                                            //publish the MQTT message for the selected film
                                                            var message = new MQTTFilmMessage("active", parseInt(userId), rows2[0].name);
                                                            mqtt.publishFilmMessage(filmId, message);

                                                            //publish the MQTT message for the deselected film
                                                            if(deselected){
                                                                var message = new MQTTFilmMessage("inactive", null, null);
                                                                mqtt.publishFilmMessage(deselected, message);
                                                            }

                                                            //inform the clients that the user selected a different film which they are working on
                                                            var updateMessage = new WSMessage('update', parseInt(userId), rows2[0].name, parseInt(filmId), rows2[0].title);
                                                            WebSocket.sendAllClients(updateMessage);
                                                            WebSocket.saveMessage(userId, new WSMessage('login', parseInt(userId), rows2[0].name, parseInt(filmId), rows2[0].title));
                                                
                                                            resolve();
                                                        
                                                    }
                                                })
                                            }
                                        })
                                }

                            })

                        }

                    })
                }

            })
        
        });
    });
}

/**
 * Utility functions
 */
exports.getFilmSelections = function getFilmSelections() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT f.id as filmId, u.id as userId, u.name as userName FROM (films as f LEFT JOIN reviews as r ON f.id = r.filmId AND active = 1) LEFT JOIN users u ON u.id = r.reviewerId WHERE private = 0";
        db.all(sql, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
      });
 }


 const getPagination = function(req) {
  var pageNo = parseInt(req.query.pageNo);
  var size = parseInt(constants.OFFSET);
  var limits = [];
  limits.push(req.params.filmId);
  limits.push(req.params.filmId);
  if (req.query.pageNo == null) {
      pageNo = 1;
  }
  limits.push(size * (pageNo - 1));
  limits.push(size);
  return limits;
}


const createReview = function(row) {
  var completedReview = (row.completed === 1) ? true : false;
  return new Review(row.fid, row.rid, completedReview, row.reviewDate, row.rating, row.review);
}