var Package = require('../package');
var path = require('path');
var fs = require('fs-extra-promise');
var temp = require('temp');
var _ = require('lodash');
var logger = require('winston');
var util = require('../util');

function Deploy(project, components, targets) {
  this._project = project;
  this._components = components;
  this._targets = targets;
}

Deploy.prototype.execute = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.stage()
      .then(function(zipStream) {
        return self._project.sfdcClient.deploy(zipStream, { rollbackOnError : true, performRetrieve: true });
      })
      .then(function(res) {
        resolve(res);
      })
      .catch(function(err) {
        reject(err);
      });
  });
};

/**
 * Deployments via metadata api require a local directory structure with a package.xml
 * @return {[type]} [description]
 */
Deploy.prototype.stage = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    try {
      var tmpPath = temp.mkdirSync({ prefix: 'mm_' });
      var unpackagedPath = path.join(tmpPath, 'unpackaged');
      fs.mkdirpSync(unpackagedPath);

      var packageXml = new Package();
      packageXml.initializeFromDocuments(self._components);
      packageXml.writeToDisk(unpackagedPath);

      /*
        here we copy project components to the tmp path for deployment
       */
      _.each(self._components, function(c) {
        if (c.isMetaXmlFile()) {
          /*
            it's possible that a component is a meta-xml file (e.g., user has compiled a single meta-xml file)
            in those cases, we need to copy both the meta-xml and associated component to the deploy folder
           */
          var associatedDocument = c.getAssociatedDocument();
          var tmpAssociatedDocumentPath = path.join(tmpPath, associatedDocument.getLocalStoreProperties().fileName);
          fs.ensureDirSync(path.dirname(tmpAssociatedDocumentPath));
          fs.copySync(associatedDocument.getPath(), tmpAssociatedDocumentPath); // copy associated component to tmp path
          fs.copySync(c.getPath(), [tmpAssociatedDocumentPath,'-meta.xml'].join('')); // copy meta-xml file as well
        } else {
          var tmpDocumentPath = path.join(tmpPath, c.getLocalStoreProperties().fileName);
          fs.ensureDirSync(path.dirname(tmpDocumentPath));
          fs.copySync(c.getPath(), tmpDocumentPath);
          if (c.getDescribe().metaFile) {
            fs.copySync([c.getPath(),'-meta.xml'].join(''), [tmpDocumentPath,'-meta.xml'].join(''));
          }
        }
      });

      /*
        zip the directory up so that it can be submitted to the metadata api for deployment
       */
      util.zipDirectory(unpackagedPath, tmpPath)
        .then(function(res) {
          var zipStream = fs.createReadStream(path.join(tmpPath, 'unpackaged.zip'));
          resolve(zipStream);
        })
        .catch(function(err) {
          throw err;
        });
    } catch(err) {
      reject(err);
    }
  });
};

module.exports = Deploy;