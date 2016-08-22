

var dynamoDb = new AWS.DynamoDB.DocumentClient();


function get_session_dynamo(session_id)
{
  params = {
    TableName: S3_BUCKET_NAME,
    Key: {
      session_id: session_id
    }
  };

  try {
    // post-process dynamo result before returning
    dyno = dynamoDb.get(params);

    session = dyno.content;
    
    // TODO: write data to temp file
    var save_file = `/tmp/${session_id}.save`;

    stats = fs.statSync(save_file);
    had_save = stats.isFile();
  }
  catch (err) {
    had_save = false;
  }
}




function put_session_dynamo(session_id)
{
  // TODO: read data from temp file
  var params = {
    TableName: "frotzlam_sessions",
    Item: {
      session_id: session_id,
      content: file_content
    }
  };
    
  // return dynamo result directly
  dynamoDb.put(params);
}
