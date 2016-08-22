
const botBuilder = require('claudia-bot-builder');
const fs = require('fs');
const execSync = require('child_process').execSync;
const AWS = require('aws-sdk');

const S3_BUCKET_NAME = "frotzlamsessions";

const games = {
  zork1: { filename: 'ZORK1.DAT', preamble: 14, postamble: 3}
};


module.exports = botBuilder(function (message, request) {

  // TODO: get this from some kind of config
  const game = games['zork1'];
  
  var isError = false;
  var text;
  
  try
  {
    var session_id = message.originalRequest.channel_id;
    const cmd_file = `/tmp/${session_id}.in`;
    var cmd;
    
    console.log("Fetching saves for " + session_id);

    var saves = fetch_saves(session_id);

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

    var gamefile = './games/' + game.filename;
    
    try {
      console.log("Attempting dfrotz execution with cmd " + cmd );
      var buffer = execSync(`./dfrotz -i -Z 0 ${gamefile} < ${cmd_file}`);
      text = `${buffer}`;
      console.log("raw response: " + text);
      
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
      console.error("dfrotz execution failed: " + text);
      console.dir(err);
      isError = true;
    }
  
  }
  catch (err) {
      ;
  }
  
  var reply = `${text}`;

  console.log("response: " + reply);
  
  //reply = debug_dump(reply);
  
  if (message.type === 'slack-slash-command') {
    const slackTemplate = botBuilder.slackTemplate;
    var response = new slackTemplate(reply);
    response.channelMessage(!isError).disableMarkdown(true);
    reply = response.get(); 
  }
  
  return reply;
});


// figure out if we have a save file already
// TODO: make this read from some lamda-safe cache and stash as a temp file

function session_file(session_id)
{
  return `/tmp/${session_id}.save`;
}

function fetch_saves(session_id)
{
  var had_save = false;
  
  try {
    //get_session_s3(session_id);
    var stats = fs.statSync(session_file(session_id));
    had_save = stats.isFile();
  }
  catch (err) {
    console.log("Failed to fetch from S3");
    console.dir(err);
    had_save = false;
  }
    
  return { had_save: had_save, save_file: session_file(session_id) };
}

function get_session_s3(session_id)
{
  var save_file = session_file(session_id);
  var s3 = new AWS.S3();
  var params = { Bucket: S3_BUCKET_NAME, Key: session_id };
  var file = fs.createWriteStream(save_file);
  s3.getObject(params).createReadStream().pipe(file);  
}


// put the save file back into a lambda-safe cache
function put_saves(session_id)
{
  try {
    put_session_s3(session_id);
  }
  catch (err)
  {
    // TODO: what to do?
    console.log("S3 put failed for session: " + session_id);
    console.dir(err);
  }
}

function put_session_s3(session_id)
{
  var save_file = session_file(session_id);

  var body = fs.createReadStream(save_file);
  var s3obj = new AWS.S3({params: {Bucket: S3_BUCKET_NAME, Key: session_id }});
  
  s3obj.upload({Body: body}).
    on('httpUploadProgress', function(evt) { console.log(evt); }).
    send(function(err, data) { console.log(err, data) });
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

function strip_lines(text, preamble, postamble)
{
  // this is sloppy but we don't have much text
  var lines = text.split('\n');
  lines = lines.filter(filterCrud);

  lines = lines.slice(preamble, lines.length - postamble);
  
  //lines = strip_carets(lines, 0);
  //lines = strip_carets(lines, 1);
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
