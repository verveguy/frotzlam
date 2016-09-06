"use strict";
/*jshint esversion: 6 */

/* 

License information

*/

/* NOTES

The use of Promises in this code is heavily informed by the *very* 
helpful article https://pouchdb.com/2015/05/18/we-have-a-problem-with-promises.html

See also this http://taoofcode.net/promise-anti-patterns/

And http://www.2ality.com/2014/10/es6-promises-api.html
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
// by making the line stripper smarter. Consider introducing
// a "last line" per game that we would then strip up to (and including)

const games = {
  zork1: { 
    filename: 'ZORK1.DAT', 
    preamble: 11, 
    postamble: 0, 
    last_line: "There is a small mailbox here."
  },
  zork2: { 
    filename: 'ZORK2.DAT', 
    preamble: 13, 
    postamble: 0, 
    last_line: "A sword of Elvish workmanship is on the ground."
  },
  zork3: { 
    filename: 'ZORK3.DAT', 
    preamble: 22, 
    postamble: 0, 
    last_line: "Your old friend, the brass lantern, is at your feet."
  }
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
    console.log("Invoked pass-through lambda");
    // the initial response. Per slack documentation, this will echo the command the user typed
    let reply = { response_type: 'in_channel' };
    return reply;
  }).catch(() => {
    console.log("Failed to invoke pass-through lambda");
    return "Failed to invoke pass-through lambda";
  });
});


// interceptor to handle recursive call (the actual call we intend)

api.intercept( (event) => {
  if (!event.slackEvent) // if this is a normal web request, let it run
    return event;
  
  return perform_slack_command(event.slackEvent);
});


const slackDelayedReply = botBuilder.slackDelayedReply;

function /* async */ perform_slack_command(message)
{
  // we use slack channel ID as session ID "one game per channel"
  let session_id = message.originalRequest.channel_id;
  let command = message.originalRequest.command;
  let text = message.text;
  
  // first, get the saved session state, if any
  return sessions.get_saved_state(session_id)
  .then( (session) => {     
    
    // then execute the actual command (sync)
    let result = execute(session, command, text);
    
    // then put the save file (async nested promise)
    return sessions.put_saved_state(session)
    .then ( () => {
      console.log("Put (save) session logically complete");
      return result;
    })
    .catch( () => {
      console.error("Put (save) session failed");
      return result;
    });
  })
  .then( (output) => {
    let reply_text;
    let reply = output;
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
    console.log("response: ", reply_text);
    return slackDelayedReply(message, reply);
  })
  .then ( () => {
    console.log("DONE");
    return false; // prevent normal execution
  })
  .catch( (error) => {
    let reply_text;
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
    console.error("error response: ", reply_text);
    return slackDelayedReply(message, reply)
      .then ( () => {
        console.log("DONE");
        return false; // prevent normal execution
      });
  });
}


/* main dfrotz invocation wrapper

session object - {save_file:, session_id:, had_save:, params: {} }
command - the slack slash command used
instruction - the text of the slash command (passed to dfrotz)

*/


function execute(session, command, instruction)
{
  let output = "To be determined...";
  let cmd_line;
  let isNewSession = !session.had_save;
  
  switch (command) {
    
    case '/frotz-game':
      console.log("Load game file", instruction);
      session.game = instruction;
      instruction = ""; // for fall-through below
      // fall through to reset game ...

    /* reset the game in progress */
    case '/frotz-reset':
      if (isNewSession) {
        console.log("Attempting reset on new session. Same as giving an instruction. Ignored");
      }
      else {
        /* reset */
        console.log("Reset session");
        session.had_save = false;
        isNewSession = true;
      }
      /* fall through to main case */
      
    /* main case, just execute the instruction as an in-game instruction */
    case "/frotz":
    case "/f":
      if (instruction === "") {
        if (isNewSession) {
          console.log("New session. No instruction given. Executing dfrotz");
        }
        else {
          console.log("Game in progress, but no instruction given. Assume 'look' intended");
          instruction = "look\n";
        }
      }
      else {
        console.log("Command is: ", instruction);
        instruction = instruction + "\n";
      }

      // build up a file with cmd content
      cmd_line = `\\ch1\n\\w\n${instruction}save\n${session.save_file}\ny\n`;

      if (!isNewSession) {
        cmd_line = `restore\n${session.save_file}\n` + cmd_line;
      }

      const cmd_file = `/tmp/${session.session_id}.in`;
  
      // default to zork1 if not specified. Picks up old game sessions
      // plus defaults new (unspecified) ones
      if (!session.hasOwnProperty('game')) {
        console.log("Session.game missing. Setting to zork1" );
        session.game = 'zork1';
      }
      
      const game = games[session.game];
      const gamefile = './games/' + game.filename;

      fs.writeFileSync(cmd_file, cmd_line);

      try {
        console.log("Attempting dfrotz execution with cmd_file: ", cmd_line );
        console.log(`exec: ./dfrotz -i -Z 0 ${gamefile} < ${cmd_file}`);
        const buffer = execSync(`./dfrotz -i -Z 0 ${gamefile} < ${cmd_file}`);
        output = `${buffer}`;
        console.log("raw response: ", output);

        if (isNewSession) {
          output = strip_lines(output, 1, game.postamble);
        }
        else {
          output = strip_lines(output, game.preamble, game.postamble);
        }
        console.log("other side of strip");
      }
      catch (err) {
        output = `${err.stdout}`;
        console.error("dfrotz execution failed: ", output);
        throw new Error(output);
      }
      finally {
        fs.unlinkSync(cmd_file);
      }
      break;
    
  }
      
  return output;
}


function filterCrud(line, index, array)
{
  if (line === ">Compression mode SPANS, hiding top 1 lines")
    return false;
  if (line.startsWith(">Please enter a filename"))
    return false;
  if (line.startsWith(">>Please enter a filename"))
    return false;
  if (line === ">")
    return false;
  if (line === ">>")
    return false;
  if (line === "Ok.")
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

  lines = lines.slice(preamble, lines.length - postamble);
  lines = lines.filter(filterCrud);
  lines = strip_carets(lines);
  
  // join the array back into a single string
  return lines.join('\n');
}


// export our api functions
module.exports = api;
