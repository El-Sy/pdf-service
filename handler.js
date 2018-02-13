'use strict';
const fs = require('fs');
const request = require('request');
const async = require('async');

const pdfFailedResponse = (message) => {
  return {
    statusCode: 400,
    body: JSON.stringify({
      message: message
    })
  }
}

const options = {
  mode: 'cors',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    "public_key": process.env.PDF_SERVICE_PUB_KEY
  })
};



const validate = (cloud_files, cb) => {
  //check for values are present
  if (cloud_files != null) {
    return cb(null, cloud_files);
  } else {
    const response = {
      statusCode: 400,
      body: JSON.stringify({
        message: "invalid cloudfile string"
      })
    }
    return cb(response);
  }
};

const getToken = (event, cb) => {
  const token_url = `${process.env.PDF_SERVICE_URL}/auth`;
  const get_token_options = Object.assign(options, {
    url: token_url,
    method: "POST"
  })

  request.post(get_token_options, (err, res, body) => {
    const response = {
      statusCode: res.statusCode,
      body: body
    };
    // no token here
    if (res.statusCode != null && res.statusCode === 200) {
      const result = JSON.parse(body);
      return cb(null, result.token);
    } else {
      return cb(pdfFailedResponse(body.error));
    }
  });
};

const getTask = (token, cb) => {
  const token_url = `${process.env.PDF_SERVICE_URL}/start/protect`;
  const start_task_options = Object.assign(options, {
    url: token_url,
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  request.get(start_task_options, (err, res, body) => {
    const response = {
      statusCode: res.statusCode,
      body: body
    };
    if (res.statusCode != null && res.statusCode === 200) {
      const result = JSON.parse(body);
      return cb(null, result, token);
    } else {
      return cb(pdfFailedResponse(body.error));
    }
  });
};

const uploadFiles = (cloud_files, taskResult, token, cb) => {
  const url = `https://${taskResult.server}/v1/upload`;
  const uploadRequests = cloud_files.map(cloud_file => {
    return {
      url: url,
      method: "POST",
      mode: 'cors',
      headers: {
        Authorization: `Bearer ${token}`
      },
      formData: {
        task: taskResult.task,
        cloud_file: cloud_file.url
      }
    }
  });

  console.log("uploadRequests[0] =========== uploading files", uploadRequests[0]);
  //only for testing
  request.post(uploadRequests[0], (err, res, body) => {
    const serverResult = {
      statusCode: res.statusCode,
      body: body
    };
    console.log("err @ uploadFiles", err);
    console.log("res @ uploadFiles", res);
    console.log("body @ uploadFiles", body)
    // no token here
    if (res.statusCode != null && res.statusCode === 200) {
      const serverResult = JSON.parse(body);
      return cb(null, serverResult, cloud_files, taskResult, token);
    } else {
      return cb(pdfFailedResponse(body.error));
    }
  });

  // uploadRequests.map(uploadRequest=>{
  //   request.post(uploadRequest, (err, res, body) => {
  //     const response = {
  //       statusCode: res.statusCode,
  //       body: body
  //     };
  //     // no token here
  //     if (res.statusCode != null && res.statusCode === 200) {
  //       const serverResult = JSON.parse(body);
  //       console.info("success");
  //       return cb(null, response);
  //     } else {
  //       return cb(err);
  //     }
  //   });
  // });
};

const processFiles = (serverResult, cloud_files, taskResult, token, cb) => {
  const url = `https://${taskResult.server}/v1/process`;
  const files = cloud_files.map(cloud_file => {
    return {
      server_filename: serverResult.server_filename,
      filename: cloud_file.filename
    }
  });

  const process_files_options = {
    url: url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    formData: {
      task: taskResult.task,
      tool: "protect",
      'files[0][server_filename]': files[0].server_filename,
      'files[0][filename]': files[0].filename,
      // webhook: "",
      password: cloud_files[0].patient.national_id
    },
    mode: 'cors'
  };

  console.log("process_files_options ============", process_files_options);

  request.post(process_files_options, (err, res, body) => {
    const response = {
      statusCode: res.statusCode,
      body: body
    };
    if (res.statusCode != null && res.statusCode === 200) {
      console.log("encryption results", response);
      return cb(null, cloud_files, taskResult, token);
    } else {
      return cb(pdfFailedResponse(body.error));
    }
  });
};

const downloadFiles = (cloud_files, taskResult, token, cb) => {
  const url = `https://${taskResult.server}/v1/download/${taskResult.task}`;
  const file = fs.createWriteStream(`/tmp/${cloud_files[0].filename}`);
  const download_files_options = {
    url: url,
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    },
    mode: 'cors'
  };


  const stream = request.get(download_files_options)
    .on('error', (err) => {
      console.error('error on downloading', err);
      return cb(err);
    })
    .pipe(file);

  stream.on('finish', (res) => {
    const response = {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Successfully saved in node container'
      }),
    }
    console.log("finishing saving file", res)

    fs.stat(`/tmp/${cloud_files[0].filename}`, (err, stat) => {
      if (err == null) {
        console.log('File exists');
        return cb(null, response)
      } else if (err.code == 'ENOENT') {
        // file does not exist
        console.log("file does not exist");
        return cb(null, response)
      } else {
        console.log('Some other error: ', err.code);
        return cb(err.code)
      }

    });
  });
};

const distribute = (target, cloud_files) => {
  //SendGrid
  //BOX
};

module.exports.process = (event, context, callback) => {

  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Successfully encrypted, store and send files',
      input: event,
    }),
  };

  const parsedBody = JSON.parse(event.body);
  console.log("========== looking at event body =======", event.body);

  const cloud_files = parsedBody.filesUploaded;

  console.log("========== cloud_files ===========", cloud_files);

  async.waterfall([
    (cb) => {
      validate(cloud_files, cb);
    },
    getToken,
    getTask,
    (taskResult, token, cb) => {
      uploadFiles(cloud_files, taskResult, token, cb);
    },
    processFiles,
    downloadFiles
    // ,
    // ()=>{
    // distribute
    // }
  ], (err, res) => {
    if (err) {
      console.error("error message", err);
      return callback(err);
    }
    else {
      return callback(null, res);
    };
  });
};