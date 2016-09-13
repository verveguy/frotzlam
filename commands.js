"use strict";
/*jshint esversion: 6 */
/*jslint node: true */
/* jshint node: true */

/* 

License information

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

var commands = module.exports = {};

// ----
// imports

const fs = require('fs');
const execSync = require('child_process').execSync;
const games = require("./games.js")
// ----
// application constants


/* main dfrotz invocation wrapper

session object - {save_file:, session_id:, had_save:, params: {} }
command - the slack slash command used
instruction - the text of the slash command (passed to dfrotz)

*/


commands.execute = function execute(session, command, instruction)
{
  let output = "To be determined...";
  let cmd_line;
  let isNewSession = !session.had_save;
  
  switch (command) {
    
    case '/frotz-game':
      console.log("Load game file", instruction);

      //check game file first
      if (!games[instruction]) {
        // unknown game
        console.log("Unknown game:", instruction);
        output = offer_other_games(instruction);
        break;
      }
      
      // game is good, fall through...
      // TODO: use slack buttons to confirm intent to load (and reset) game state
      session.game = instruction;
      instruction = ""; // for fall-through below
      // fall through to reset game ...

    /* reset the game in progress */
    case '/frotz-reset':
      /* reset */
      console.log("Reset session");
      isNewSession = true;
      instruction = "";
      /* fall through to main case */
      
    /* main case, just execute the instruction as an in-game instruction */
    case "/frotz":
    case "/f":
      if (!session.hasOwnProperty('game')) {
        if (isNewSession) {
          console.log("New session, unknown game." );
          output = offer_games();
          break;
        }
        else {
          // default to zork1 if not specified. Picks up old game sessions
          // plus defaults new (unspecified) ones
          console.log("Session.game missing. Assuming zork1" );
          session.game = 'zork1';
        }
      }
      
      if (isNewSession) {
        // should we ignore any immediate command given?
        if (instruction === "look") {
          // this would make a "double look" which is clumsy since a new session
          // always prints out the current room description anyhow
          instruction = "";
        }
        // else allow other instructions to come through even on first session (jumping the gun)
      }
      else if (instruction === "") {
        console.log("Game in progress, but no instruction given. Assume 'look' intended");
        instruction = "look\n";
      }
      else {
        console.log("Command is: ", instruction);
        instruction = instruction + "\n";
      }

      // build up a file with cmd content
      cmd_line = `---BOGUS SENTINEL LINE---\n\\ch1\n\\w\n${instruction}save\n${session.save_file}\n`;

      if (session.had_save) {
        // make sure we overwrite old save file
        cmd_line  = cmd_line + 'y\n';
      }
      
      if (!isNewSession) {
        // restore the old game state if needed
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
      // we double-check this, since old sessions could have games that no longer exist
      if (game) {
        const gamefile = './games/' + game.filename;
      
        fs.writeFileSync(cmd_file, cmd_line);

        try {
          console.log("Attempting dfrotz execution with cmd_file: ", cmd_line );
        
          let dfrotz = `./dfrotz -S 0 -m -w 255 -i -Z 0 ${gamefile} < ${cmd_file}`;
        
          console.log('exec:', dfrotz);
          const buffer = execSync(dfrotz);
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
      }
      else {
        // unknown game
        console.log("Unknown game:", session.game);
        output = offer_other_games(sessions.game);
      }
      
      break;
    
  }
      
  return output;
};


function offer_games()
{
  return offer_other_games(undefined)
}

function offer_other_games(bad_game)
{
  let output;
  if (bad_game)
    output = `Sorry, I don't know how to play the game ${bad_game} (yet).\nPlease enjoy one of these instead:\n`;
  else
    output = `Please select a game using the /frotz-game command with one of these choices:\n`;
  
  for (var key in games) {
    let entry = games[key];
    if (entry)
      output += `${key}: ${entry.name}\n`;
  }
  
  return output;
}

function filterCrud(line, index, array)
{
  if (line === sentinel_line)
    return false;
  if (line === ">Compression mode SPANS, hiding top 1 lines")
    return false;
  if (line === ">")
    return false;
  if (line === ">>")
    return false;
  if (line === "Ok.")
    return false;
  if (line.startsWith(">Please enter a filename"))
    return false;
  if (line.startsWith(">>Please enter a filename"))
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
  let lines = text.split('\n');

  if (preamble == -1) {
    // look for sentinel line
    const len = lines.length;
    let junk = 0;
    for (junk = 0; junk < len; junk++)
      if (lines[junk] === sentinel_line)
        break;
    preamble = junk;
  }
  
  lines = lines.slice(preamble, lines.length - postamble);
  lines = lines.filter(filterCrud);
  lines = strip_carets(lines);
  
  // join the array back into a single string
  return lines.join('\n');
}
