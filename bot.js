"use strict";
/*jshint esversion: 6 */

const botBuilder = require('claudia-bot-builder');
const fs = require('fs');
const execSync = require('child_process').execSync;
const AWS = require('aws-sdk');

const S3_BUCKET_NAME = "frotzlamsessions";

//TODO: clean up this hackery of "preamble" and "postamble"
// by making the line stripper smarter
const games = {
  zork1: { filename: 'ZORK1.DAT', preamble: 14, postamble: 2}
};


module.exports = /* async */ botBuilder(function (message, request) {
  // TODO: get this from some kind of config
  const game = games['zork1'];

  return Promise.resolve(message.originalRequest.channel_id)
  .then( (session_id) => {
    return load_saved_state(session_id)
      .then( (saves) => {     // then execute the dfrotz command (sync)
      let cmd_line;
      let text = "to be determined...";  
  
      var command = message.text;
      if (command === "") {
        console.log("No command given. Executing dfrotz");
      }
      else {
        console.log("Command is: " + command);
        command = command + "\n";
      }
  
      if (saves.had_save) {
        cmd_line = `restore\n${saves.save_file}\n\\ch1\n\\w\n${command}save\n${saves.save_file}\ny\n`;
      }
      else {
        cmd_line = `\\ch1\n\\w\n${command}save\n${saves.save_file}\n`;
      }

      const cmd_file = `/tmp/${session_id}.in`;
      // build up a file with cmd content
      fs.writeFileSync(cmd_file, cmd_line);

      const gamefile = './games/' + game.filename;
  
      try {
        console.log("Attempting dfrotz execution with cmd " + cmd_line );
        const buffer = execSync(`./dfrotz -i -Z 0 ${gamefile} < ${cmd_file}`);
        text = `${buffer}`;
        console.log("raw response: " + text);
    
        //fs.unlinkSync(cmd_file);
        if (saves.had_save) {
          text = strip_lines(text, game.preamble, game.postamble);
        }
        else {
          text = strip_lines(text, 1, game.postamble);
        }
      }
      catch (err) {
        text = `${err.stdout}`;
        console.error("dfrotz execution failed: " + text);
        console.dir(err);
        throw new Error(text);
      }

      // then put the save file (async nested promise)
      return put_saves(session_id)
      .then ( (ignore) => {
        console.log("Put save logically complete");
        return `${text}`;
      })
      .catch( (error) => {
        console.error("Put save failed");
        throw new Error("error: failed to save game state");
      });
    })
    .then ( (frotz) => {
      let reply_text;
      let reply = frotz;
      if (message.type === 'slack-slash-command') {
        const slackTemplate = botBuilder.slackTemplate;
        const response = new slackTemplate(reply);
        response.channelMessage(true).disableMarkdown(true);
        reply = response.get();
        reply_text = reply.text; 
      }
      else {
        reply_text = reply; 
      }
      // finally, resolve with this response
      console.log("response: " + reply_text);
      return reply;
    })
    .catch ( (error) => {
      let reply_text;
      //reply = debug_dump(text);
      let reply = "error: " + error;
      if (message.type === 'slack-slash-command') {
        const slackTemplate = botBuilder.slackTemplate;
        let response = new slackTemplate(reply);
        response.channelMessage(true).disableMarkdown(true);
        reply = response.get(); 
        reply_text = reply.text; 
      }
      else {
        reply_text = reply; 
      }
      // finally, resolve with this response
      console.log("error response: " + reply_text);
      return reply;
    });
  });
});

function load_saved_state(session_id) {

    console.log("Fetching saves for " + session_id);

    var saves = fetch_saves(session_id);
  
    return saves;
}


function session_filename(session_id)
{
  return `/tmp/${session_id}.save`;
}

// figure out if we have a save file already

function /* async */ fetch_saves(session_id)
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

function /* async */ get_session(session_id)
{
  return Promise.resolve(session_id)
  .then((session_id) => {
    console.log("NOOP get state session id:" + session_id);
    return "dummy";
  });
}

process.on('uncaughtException', function (err) {
  console.log("Uncaught exception: " + err);
})

function /* async */ get_session_s3(session_id)
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

function /* async */ put_saves(session_id)
{
  return put_session_s3(session_id);
  //return put_session(session_id);
}

function /* async */ put_session(session_id)
{
  return Promise.resolve(session_id)
  .then((session_id) => {
    console.log("NOOP put state session id:" + session_id);
    return "dummy";
  });
}

function /* async */ put_session_s3(session_id)
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

function filterCrud(line, index, array)
{
  if (line === ">Compression mode SPANS, hiding top 1 lines")
    return false;
  if (line.startsWith(">Please enter a filename"))
    return false;
  if (line.startsWith(">>Please enter a filename"))
    return false;
  if (line === "Ok.")
    return false;
  if (line === ">>")
    return false;
 
  return true;
}

function strip_carets_line(arr, index)
{
  // trim the '>>' off the first line if present
  var line = arr[index];
  var res = line.slice(0,2);
  if (res == '>>') {
    arr[index] = line.slice(2);
  }
  return arr;
}

function strip_carets(arr)
{
  const len = arr.length;
  for (var i = 0; i < len; i++)
    strip_carets_line(arr, i);
  return arr;
}

//TODO: clean up this hackery of "preamble" and "postamble"
// by making the line stripper smarter
function strip_lines(text, preamble, postamble)
{
  // this is sloppy but we don't have much text
  var lines = text.split('\n');
  lines = lines.filter(filterCrud);

  lines = lines.slice(preamble, lines.length - postamble);
  
  lines = strip_carets(lines);
  
  // join the array back into a single string
  return lines.join('\n');
}


function debug_dump(reply)
{
  var buffer = execSync(`ls -al /tmp/`);
  reply = `${reply}\n\n${buffer}`;
  return reply;
}
