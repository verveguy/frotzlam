"use strict";
/*jshint esversion: 6 */
/*jslint node: true */
/* jshint node: true */

/* 

Copyright (C) Brett Adam 2016. All rights reserved.

*/

/* NOTES

The use of Promises in this code is heavily informed by the *very* 
helpful article https://pouchdb.com/2015/05/18/we-have-a-problem-with-promises.html

See also this http://taoofcode.net/promise-anti-patterns/

And http://www.2ality.com/2014/10/es6-promises-api.html

TODO:

Consider adding "confirm?" buttons to the /frotz-reset and /frotz-game commands
Consider adding a "non-game" state before a game is loaded. Interactive bot style
Consider allowing upload of your own games files. Via slack attachment?
  Would require some kind of "last_line" info as well as the binary
  Could we automatically compute "last_line" by observing output? Probably...
  
*/

// ----
// imports

const botBuilder = require('claudia-bot-builder');
const fs = require('fs');
const execSync = require('child_process').execSync;
const AWS = require('aws-sdk');
const sessions = require('./sessions.js');
const commands = require('./commands.js');

// so we can recursively invoke our real handler
const lambda = new AWS.Lambda();


// API handler. Uses botBuilder to assemble the boilerplate functions

/*
  TODO: consider whether we should also offer a "trigger-free" interface
  using a simple Slack webhook so that any text typed in channel is 
  interpreted as an in-game command. Thus:
  
  /frotz go west 
  
  becomes
  
  go west

  the slackalytics integration uses claudiajs without botbuilder for
  this purpose
*/

const api = /* async */ botBuilder( (message, apiRequest) => {

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
    let result = commands.execute(session, command, text);
    
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

// export our api functions
module.exports = api;
