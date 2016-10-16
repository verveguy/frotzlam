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

// TODO: note that for games where auto-detect fails, 
// we need a last_line sentinel and set preamble = -2

const games = {
  zork1: { 
    name: "Zork I - The Great Underground Empire",
    filename: 'ZORK1.DAT', 
    preamble: -1, // means we auto-detect preamble
    header: 1, // means there's always a header line on startup, before we can supress it
    kickstart: "", // no "enter to continue" or equivalent needed
    postamble: 0
  },
  zork2: {
    name: "Zork II - The Wizard of Frobozz",
    filename: 'ZORK2.DAT', 
    preamble: -1, // means we auto-detect preamble
    header: 1,
    kickstart: "",
    postamble: 0 
  },
  zork3: { 
    name: "Zork III - The Dungeon Master",
    filename: 'ZORK3.DAT', 
    preamble: -1, // means we auto-detect preamble
    header: 1,
    kickstart: "",
    postamble: 0 
  },
  harmonic: { 
    name: "Harmonic Time-Bind Ritual Symphony",
    site_url: "http://www.springthing.net/2016/play.html#HarmonicTimeBindRitualSymphony",
    filename: 'harmonic.z8', 
    preamble: -1, // means we auto-detect preamble
    header: 0, // there's no header junk on this one
    kickstart: "\n",  // this game needs "enter to continue" every time it loads...
    postamble: 0 
  }
  
};

module.exports = games;


