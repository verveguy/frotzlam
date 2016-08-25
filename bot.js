"use strict";
/*jshint esversion: 6 */

/* 

License information

*/

/* NOTES

The use of Promises in this code is heavily informed by the *very* 
helpful article https://pouchdb.com/2015/05/18/we-have-a-problem-with-promises.html

*/

// ----
// imports

const botBuilder = require('claudia-bot-builder');
const fs = require('fs');
const execSync = require('child_process').execSync;
const AWS = require('aws-sdk');
const sessions = require('./sessions.js');

// so we can recursively invoke our real handler
const lambda = new AWS.Lambda();

// ----
// application constants

//TODO: clean up this hackery of "preamble" and "postamble"
// by making the line stripper smarter
const games = {
  zork1: { filename: 'ZORK1.DAT', preamble: 14, postamble: 2}
};


// API handler. Uses botBuilder to assemble the boilerplate functions

const api = /* async */ botBuilder(function (message, apiRequest) {

  // this is our "quick response" to ensure slack hears from us promptly.
  // See https://claudiajs.com/tutorials/slack-delayed-responses.html
  return new Promise((resolve, reject) => {
    lambda.invoke({
      FunctionName: apiRequest.lambdaContext.functionName,
      Qualifier: apiRequest.lambdaContext.functionVersion,
      InvocationType: 'Event',
      Payload: JSON.stringify({
        slackEvent: message // this will enable us to detect the event later and filter it
      })
    }, (err, done) => {
      if (err) return reject(err);
      resolve(done);
    });
  }).then(() => {
    // the initial response. Per slack documentation, this will echo the command the user typed
    let reply = { response_type: 'in_channel' };
    return reply;
  }).catch(() => {
    console.log("Failed to invoke pass-through lambda");
    return "Failed to invoke pass-through lambda";
  });
});


// interceptor to handle recursive call (the actual call we intend)

const slackDelayedReply = botBuilder.slackDelayedReply;

api.intercept((event) => {
  if (!event.slackEvent) // if this is a normal web request, let it run
    return event;

  const message = event.slackEvent;

    // TODO: get this from some kind of config
  const game = games['zork1'];

  return Promise.resolve(message.originalRequest.channel_id)
  .then( (session_id) => {
    return sessions.get_saved_state(session_id)
    .then( (saves) => {     // then execute the dfrotz command (sync)
      let cmd_line;
      let text = "to be determined...";  
      let isNewGame = saves.had_save;
      
      let command = message.text;
      if (command === "") {
        if (isNewGame) {
          console.log("Game in progress, but no command given. Assume 'look' intended");
          command = "look\n";
        }
        else {
          console.log("No command given. Executing dfrotz");
        }
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
      return sessions.put_saved_state(session_id)
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
      return slackDelayedReply(message, reply);
    })
    .then(() => false) // prevent normal execution
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
      return slackDelayedReply(message, reply);
    });
  });
});


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

module.exports = api;
