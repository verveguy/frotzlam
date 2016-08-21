const botBuilder = require('claudia-bot-builder');
const excuse = require('huh');
const fs = require('fs');
const execSync = require('child_process').execSync;

const games = {
  zork1: { filename: 'ZORK1.DAT', preamble: 14, postamble: 3}
}


module.exports = botBuilder(function (message, request) {
  //return `Thanks for sending ${request.text}. Your message is very important to us, but ${excuse.get()}`/frto;

  // TODO: get this from some kind of config
  const game = games['zork1'];
  
  var isError = false;
  
  try
  {
    var session_id = message.originalRequest.channel_id;
    const cmd_file = `/tmp/${session_id}.in`;
    var cmd;
    
    saves = fetch_saves(session_id);

    var command = message.text;
    if (command !== "")
      command = command + "\n";
    
    if (saves.had_save) {
      cmd = `restore\n${saves.save_file}\n\\ch1\n\\w\n${command}save\n${saves.save_file}\ny\n`;
    }
    else {
      cmd = `\\ch1\n\\w\n${command}save\n${saves.save_file}\n`;
    }

    // build up a file with cmd content
    fs.writeFileSync(cmd_file, cmd);

    gamefile = './games/' + game.filename;
    
    try {
      buffer = execSync(`./dfrotz -i -Z 0 ${gamefile} < ${cmd_file}`);
      text = `${buffer}`;
      
      //fs.unlinkSync(cmd_file);
      if (saves.had_save) {
        text = strip_lines(text, game.preamble, game.postamble);
      }
      else {
        text = strip_lines(text, 1, game.postamble);
      }
      
      put_saves(session_id);
    }
    catch (err) {
      text = `${err.stdout}`;
      isError = true;
    }
  
  }
  catch (err) {
      ;
  }
  
  reply = `${text}`;
  
  //reply = debug_dump(reply);
  
  if (message.type === 'slack-slash-command') {
    const slackTemplate = botBuilder.slackTemplate;
    response = new slackTemplate(reply);
    response.channelMessage(!isError).disableMarkdown(true);
    reply = response.get(); 
  }
  
  return reply;
});


// figure out if we have a save file already
// TODO: make this read from some lamda-safe cache and stash as a temp file

function fetch_saves(session)
{
  var had_save = false;
  var save_file = `/tmp/${session}.save`;
  var stats;
  
  try {
    stats = fs.statSync(save_file);
    had_save = stats.isFile();
  }
  catch (err) {
    had_save = false;
  }
  
  return { had_save: had_save, save_file: save_file };
}


// put the save file back into a lambda-safe cache
function put_saves(session)
{
  
}

function filterCrud(line, index, array)
{
  if (line === ">Compression mode SPANS, hiding top 1 lines")
    return false;
  if (line === "Ok.")
    return false;
  if (line === ">>")
    return false;
 
  return true;
}

function strip_carets(arr, index)
{
  // trim the '>>' off the first line if present
  line = arr[index];
  res = line.slice(0,2);
  if (res == '>>') {
    arr[index] = line.slice(2);
  }
  return arr;
}

function strip_lines(text, preamble, postamble)
{
  // this is sloppy but we don't have much text
  var lines = text.split('\n');
  lines = lines.filter(filterCrud);

  lines = lines.slice(preamble, lines.length - postamble);
  
  lines = strip_carets(lines, 0);
  lines = strip_carets(lines, 1);
  
  // join the array back into a single string
  return lines.join('\n');
}


function debug_dump(reply)
{
  buffer = execSync(`ls -al /tmp/`);
  reply = `${reply}\n\n${buffer}`;
  return reply;
}
