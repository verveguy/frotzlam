"use strict";
/*jshint esversion: 6 */

/* 

License information

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


sessions.get_saved_state = function get_saved_state(session_id) {

    console.log("Fetching saves for " + session_id);

    var saves = fetch_saves(session_id);
  
    return saves;
}


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
    .then( (value) => {
      // console.log("Checking local tmp file " + session_file);
      try {
        // const buffer = execSync('ls -al /tmp');
        // const text = `${buffer}`;
        // console.log("tmp dir: " + text);
      
        const stats = fs.statSync(session_file);
        let had_save = stats.isFile();
        console.log("Found local tmp file. Continuing game");
        return { had_save: had_save, save_file: session_file };
      }
      catch (err) {
        // console.error(err);
        console.log("Local tmp file doesn't exist. Proceeding as new game");
        // we continue, this isn't an error per se
        return { had_save: false, save_file: session_file };
      }
    })
    .catch ( (error) => {
      console.log("Failed to fetch state. Proceeding as new game");
      // console.dir(error);
      // we continue, this isn't an error per se
      return { had_save: false, save_file: session_file };
    });
  });
}

function get_session(session_id) /* async */ 
{
  return Promise.resolve(session_id)
  .then((session_id) => {
    console.log("NOOP get state session id:" + session_id);
    return "dummy";
  });
}

function get_session_s3(session_id) /* async */ 
{
  return Promise.resolve(session_id)
  .then( (session_id) => {
    // check if the stupid object exists with headObject
    console.log("About to S3 headObject");
    let s3 = new AWS.S3({params: {Bucket: S3_BUCKET_NAME, Key: session_id}});
    return s3.headObject({Bucket: S3_BUCKET_NAME, Key: session_id }).promise()
    .then( (dummy) => {
      console.log("dummy: " + dummy);
      return new Promise((resolve, reject) => {
        let session_file = session_filename(session_id);
        let file = fs.createWriteStream(session_file);
        file.on("finish", () => resolve(session_file));
        file.on("error", err => {
          console.log("S3 get failed with error:" + err);
          reject(err);
        });
        console.log("About to S3 getObject");
        let s3 = new AWS.S3({params: {Bucket: S3_BUCKET_NAME, Key: session_id}});
        var getReq = s3.getObject().createReadStream().pipe(file);
      });
    })
    .catch( (error) => {
      console.log("S3 head failed with error:" + error);
      throw new Error(error);
    });
  });
}


// put the save file back into a lambda-safe cache

sessions.put_saved_state = function put_saved_state(session_id) /* async */ 
{
  return put_session_s3(session_id);
  //return put_session(session_id);
}

function put_session(session_id) /* async */
{
  return Promise.resolve(session_id)
  .then((session_id) => {
    console.log("NOOP put state session id:" + session_id);
    return "dummy";
  });
}

function put_session_s3(session_id) /* async */
{
  return Promise.resolve(session_id)
  .then( (session_id) => {
    var save_file = session_filename(session_id);
    var body = fs.createReadStream(save_file);
    var s3 = new AWS.S3({params: {Bucket: S3_BUCKET_NAME, Key: session_id }});
    return s3.putObject({Body: body}).promise();
  })
  .catch( (error) => {
    console.log("S3 put failed with error:" + error);
    throw new Error(error);
  });
}
