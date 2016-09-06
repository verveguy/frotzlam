"use strict";
/*jshint esversion: 6 */
/*jslint node: true */
/* jshint node: true */

/* 

License information

<MIT> ?
*/


/* 

TODO: consider adding more information to the session context data held
in dynamodb. Perhaps the slack team name, etc.

*/


var sessions = module.exports = {};

// ----
// imports
const fs = require('fs');
const execSync = require('child_process').execSync;
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient();

// ----
// application constants
const S3_BUCKET_NAME = "frotzlamsessions";
const CTX_TBL_NAME = 'frotzlamsessions';


sessions.get_saved_state = /* async */ function get_saved_state(session_id)
{
    console.log("Fetching saves for:", session_id);

    return restore_context(session_id)
      .then( (session) => {
        console.log('CONTEXT:', JSON.stringify(session));
        if (!session) {
          console.log("dynamo session undefined");
          session = { session_id: session_id, counter: 0 };
        }
        return fetch_saves(session);
      });
};


function session_filename(session_id)
{
  return `/tmp/${session_id}.save`;
}

// figure out if we have a save file already

function fetch_saves(session) /* async */ 
{
   return get_session_s3(session.session_id)
   .then( (filename) => {
    try {
    
      const stats = fs.statSync(filename);
      let had_save = stats.isFile();
      console.log("Found local tmp file. Continuing session");
      session.had_save = had_save;
      session.save_file = filename;
      
      return session;
    }
    catch (err) {
      // console.error(err);
      console.log("Local tmp file doesn't exist. Proceeding as new session");
      // we continue, this isn't an error per se
      session.had_save = false;
      session.save_file = filename;
      
      return session;
    }
  })
  .catch( (error) => {
    console.log("Failed to fetch state. Proceeding as new session");
    // console.dir(error);
    // we continue, this isn't an error per se
    session.had_save = false;
    // still need to set this for saving the initial game state
    session.save_file = session_filename(session_id);  
    
    return session;
  });
}

function get_session_s3(session_id) /* async */ 
{
  return get_fileobject_s3(S3_BUCKET_NAME, session_id, session_filename(session_id));
}

function get_fileobject_s3(bucket, key, filename) /* async */ 
{
  return Promise.resolve()
  .then( () => {
    // check if the stupid object exists with headObject
    let s3 = new AWS.S3();
    return s3.headObject({Bucket: bucket, Key: key }).promise()
    .then( () => {
      return new Promise((resolve, reject) => {
        let file = fs.createWriteStream(filename);
        file.on("finish", () => resolve(filename));
        file.on("error", (error) => {
          console.error("S3 get failed with error", error);
          reject(error);
        });
        let s3 = new AWS.S3();
        s3.getObject({Bucket: bucket, Key: key}).createReadStream().pipe(file);
      });
    })
    .catch( (error) => {
      console.error("S3 head failed with error", error);
      throw error;
    });
  });
}


// put the save file back into a lambda-safe cache

sessions.put_saved_state = function put_saved_state(session) /* async */ 
{
  return put_session_s3(session).then( () => { 
      return persist_context(session); 
    });
};

function put_session_s3(session) /* async */
{
  let filename = session.save_file;
  
  return safeCreateReadStream(filename)
  .then( (stream) => {
    var s3 = new AWS.S3({params: {Bucket: S3_BUCKET_NAME, Key: session.session_id }});
    return s3.putObject({Body: stream}).promise();
  })
  .catch( (error) => {
    console.error("S3 put failed with error", error);
    throw new Error(error);
  });
}


function /* async */ safeCreateReadStream(filename) {

  // See http://stackoverflow.com/questions/17136536/is-enoent-from-fs-createreadstream-uncatchable
  return new Promise((resolve, reject) => {
    let stream = fs.createReadStream(filename);
    stream.on("readable", () => resolve(stream));
    stream.on("error", (error) => {
      console.error("createReadStream failed with error:", error);
      reject(error);
    });
  });
  
}

/*
  Context functions, built on dynamoDB
*/

// restore session context from dynamodb
function restore_context(session_id)
{
  console.log("Trying to restore context for session", session_id);

  var params = {
    TableName: CTX_TBL_NAME,
    Key: {
      'session_id': session_id
    }
  };

  return dynamodb.get(params).promise()
  .then( (data) => {
    return data.Item;
  });
}

// persist context to dynamodb
function persist_context(session)
{
  console.log("Persisting context for session", session.session_id);

  session.counter += 1;
  
  var params = {
      TableName: CTX_TBL_NAME,
      Item: session
  };

  return dynamodb.put(params).promise();
}

