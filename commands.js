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

// ----
// application constants

// TODO: note that for games where auto-detect fails, 
// we need a last_line sentinel and set preamble = -2

const games = {
  zork1: { 
    filename: 'ZORK1.DAT', 
    preamble: -1, // means we auto-detect preamble
    postamble: 0
  },
  zork2: { 
    filename: 'ZORK2.DAT', 
    preamble: -1, // means we auto-detect preamble
    postamble: 0 
  },
  zork3: { 
    filename: 'ZORK3.DAT', 
    preamble: -1, // means we auto-detect preamble
    postamble: 0 
  },
  svt: { 
    name: "Superluminal Vagrant Twin",
    site_url: "https://pacian.itch.io/superluminal-vagrant-twin",
	filename: 'Superluminal Vagrant Twin.gblorb', 
    preamble: -1, // means we auto-detect preamble
    postamble: 0 
  }
  
};

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
        // TODO: make this iterate the known games collection
        output = `Sorry, I don't know how to play the game ${session.game} (yet).\nPlease try one of the games I know:\nzork1, zork2, zork3`;
      }
      
      break;
    
  }
      
  return output;
};



const sentinel_line = '>I don\'t know the word "---bogus".';

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
