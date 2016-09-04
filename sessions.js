"use strict";
/*jshint esversion: 6 */

/* 

License information

*/


/* 

TODO: load *two* objects per session - the save file and a session JSON object
with other session params (like game to play ...)

*/


var sessions = module.exports = {};

// ----
// imports
const fs = require('fs');
const execSync = require('child_process').execSync;
const AWS = require('aws-sdk');

// ----
// application constants
const S3_BUCKET_NAME = "frotzlamsessions";


sessions.get_saved_state = function get_saved_state(session_id)
{
    console.log("Fetching saves for:", session_id);

    var session = fetch_saves(session_id);
  
    return session;
};


function session_filename(session_id)
{
  return `/tmp/${session_id}.save`;
}

// figure out if we have a save file already

function fetch_saves(session_id) /* async */ 
{
  return  Promise.resolve(session_filename(session_id))
  .then( (session_file) => {
    //return get_session(session_id)
    return get_session_s3(session_id)
    .then( (filename) => {
      // console.log("Checking local tmp file " + session_file);
      try {
        // const buffer = execSync('ls -al /tmp');
        // const text = `${buffer}`;
        // console.log("tmp dir: " + text);
      
        const stats = fs.statSync(session_file);
        let had_save = stats.isFile();
        console.log("Found local tmp file. Continuing session");
        return { had_save: had_save, save_file: session_file, session_id: session_id };
      }
      catch (err) {
        // console.error(err);
        console.log("Local tmp file doesn't exist. Proceeding as new session");
        // we continue, this isn't an error per se
        return { had_save: false, save_file: session_file, session_id: session_id };
      }
    })
    .catch( (error) => {
      console.log("Failed to fetch state. Proceeding as new session");
      // console.dir(error);
      // we continue, this isn't an error per se
      return { had_save: false, save_file: session_file, session_id: session_id };
    });
  });
}

function get_session(session_id) /* async */ 
{
  return Promise.resolve(session_id)
  .then( (session_id) => {
    console.log("NOOP get state session id:" + session_id);
    return "dummy";
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
  return put_session_s3(session);
  //return put_session(session_id);
};

function put_session(session) /* async */
{
  return Promise.resolve(session.session_id)
  .then((session_id) => {
    console.log("NOOP put state session id:" + session_id);
    return "dummy";
  });
}

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
