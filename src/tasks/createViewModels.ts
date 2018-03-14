import { Import } from "./model/import";
import {ClassMetadata} from "./model/classmetadata";
import {FieldMetadata} from "./model/fieldmetadata";
import {FileMetadata} from "./model/filemetadata";
import {Options, FileMapping} from "./model/options";
import {IExtensionGruntFilesConfig} from "./model/extensionFileConfig";
import {parseStruct, ImportNode} from "ts-file-parser";
import {ArrayType, BasicType} from "ts-file-parser";
import {render, renderString, configure} from "nunjucks";
import * as path from "path";
import { Transformer } from "./model/transformer";
import { ViewModelTypeOptions } from "./model/viewModelTypeOptions";
import { GenerateViewOptions } from "./model/generateViewOptions";
import * as fs from "fs";
import { Config } from "./model/config";


export function createViewModelsInternal(): string [] {
    let possibleFiles: string[] = [];
    let config = <Config>JSON.parse(fs.readFileSync("generateViewConfig.json","utf8"));
    getAllfiles("./", possibleFiles, config.ignore.folders);
    var  metadata = createMetadatas(possibleFiles);
    var resultTemplate = CreateFiles(metadata);
    return resultTemplate;
}

export function createOptionsOfGrunt(obj: IGrunt): Options {
    var options = new Options();
    var files = new Array<FileMapping>();
    for (var i = 0; i < obj.task.current.files.length; i++) {
        var file = new FileMapping();
        if (obj.task.current.files[i].src.length === 1) {
            file.source = obj.task.current.files[i].src[0];
        } else {
            file.source = obj.task.current.files[i].src[0];
        }
        file.destination = obj.task.current.files[i].dest;
        files.push(file);
    }

    options.files = files;
    if (obj.task.current.data.oneFile && obj.task.current.files.length) {
        var fileConfig = obj.task.current.files[0] as IExtensionGruntFilesConfig;
    }
    return options;
}

export function createMetadatas(files: string[]): FileMetadata[] {
    var fs = require("fs");
    let generationFiles: FileMetadata[];
    generationFiles = new Array<FileMetadata>();
    for (var file of files) {
        if(/\w+tmp.ts$/.exec(file)) {
            console.log('tmp');
            break;
        }
        console.log(file);
        var stringFile = fs.readFileSync(file, "utf-8");
        let correctStringFile  = ViewModelTypeCorrecting(stringFile);
        let tmpFileSource = file.split(".ts").join("tmp.ts");
        fs.writeFileSync(tmpFileSource, correctStringFile, "utf-8");
        var jsonStructure = parseStruct(correctStringFile, {}, tmpFileSource);
        fs.unlinkSync(tmpFileSource);
        let possibleImports = jsonStructure._imports;

        jsonStructure.classes.forEach(cls => {
            let classMet = new ClassMetadata();
            let classMets = new Array<ClassMetadata>();

            classMet.name = cls.name;
            classMet.fields = new Array<FieldMetadata>();
            let classMetsFields = new Array<Array<FieldMetadata>>();

            cls.decorators.forEach(dec => {
                if (dec.name === "GenerateView") {
                    let genViewOpt = <GenerateViewOptions>dec.arguments[0].valueOf();
                    if (classMet.generateView === false) {
                        classMet.generateView = true;
                        let tmpArray = genViewOpt.modelName.split("/");
                        classMet.name = tmpArray[tmpArray.length - 1 ].split(".ts")[0];
                        classMet.name = classMet.name[0].toUpperCase() + classMet.name.substring(1);
                        classMets.push(classMet);

                        FillFileMetadataArray(generationFiles, genViewOpt, file);
                    } else {
                        let otherClassMet = new ClassMetadata();
                        otherClassMet.generateView = true;
                        let tmpArray = genViewOpt.modelName.split("/");
                        otherClassMet.name = tmpArray[tmpArray.length - 1 ].split(".ts")[0];
                        otherClassMet.name = otherClassMet.name[0].toUpperCase() + otherClassMet.name.substring(1);
                        otherClassMet.fields = new Array<FieldMetadata>();
                        classMets.push( otherClassMet);

                        FillFileMetadataArray(generationFiles, genViewOpt, file);
                    }
                }
                if (dec.name === "NeedMapper") {
                    classMets.forEach(clMet => {
                        clMet.needMapper = true;
                    });
                }
            });
            if (classMet.generateView === false) {
                return;
            }
            classMets.forEach(cm => {
                cm.baseName = cls.name;
                cm.baseNamePath =  file;
                cls.fields.forEach(fld => {
                    let fldMetadata = new FieldMetadata();
                    fldMetadata.isNullable = fld.optional;
                    fldMetadata.baseModelName = fld.name;
                    if (fld.type.typeKind === 1) {
                        fldMetadata.isArray = true;
                    }
                    if ((<ArrayType>fld.type).base !== undefined) {
                        fldMetadata.baseModelType = (<BasicType>(<ArrayType>fld.type).base).typeName;
                        var curBase = (<ArrayType>fld.type).base;
                        while ((<ArrayType>curBase).base !== undefined) {
                            curBase = (<ArrayType>curBase).base;
                            fldMetadata.baseModelType = (<BasicType>curBase).typeName;
                        }
                    } else {
                        fldMetadata.baseModelType = (<BasicType>fld.type).typeName;
                    }
                    let typeName = fldMetadata.baseModelType;
                    if (typeName !== "string" && typeName !== "number" && typeName !== "boolean" && typeName !== "undefined"
                    && typeName !== "null") {
                        fldMetadata.isComplexType = true;
                    }
                    fldMetadata.name = fld.name;
                    fldMetadata.type = fldMetadata.baseModelType;

                    fld.decorators.forEach(dec => {
                        if (dec.name === "IgnoreViewModel") {
                            if (dec.arguments[0] && dec.arguments[0].toString() === cm.name) {
                                fldMetadata.ignoredInView = true;
                            } else if (!dec.arguments[0]) {
                                fldMetadata.ignoredInView = true;
                            }
                        }
                        if (dec.name === "ViewModelName") {
                            if (dec.arguments[1] && dec.arguments[1].toString() === cm.name) {
                                fldMetadata.name = dec.arguments[0].toString();
                            } else if (!dec.arguments[1]) {
                                fldMetadata.name = dec.arguments[0].toString();
                            }
                        }
                        if (dec.name === "ViewModelType") {
                            let fieldTypeOptions = <ViewModelTypeOptions>dec.arguments[0].valueOf();
                            if ((fieldTypeOptions.modelName && fieldTypeOptions.modelName === cm.name) || (!fieldTypeOptions.modelName )) {
                                fldMetadata.type = fieldTypeOptions.type.toString();
                                if ( fldMetadata.type.toLowerCase() === "string" && fldMetadata.type !== fldMetadata.baseModelType ) {
                                    fldMetadata.type = "string";
                                    fldMetadata.toStringWanted = true;
                                }
                            }
                            if (fieldTypeOptions.transformer) {
                                fldMetadata.fieldConvertFunction = fieldTypeOptions.transformer;
                                let isBreak = false;

                            }
                        }
                    });
                    cm.fields.push(fldMetadata);
                });
            });
            generationFiles.forEach(genFile => {
                classMets.forEach( cm => {
                    if (genFile.filename.indexOf(cm.name[0].toLowerCase() + cm.name.substring( 1 ) + ".ts") > -1) {
                        genFile.classes.push(cm);
                    }
                });
                makeCorrectImports(genFile, possibleImports);
            });
        });
    }
    return generationFiles.filter(file => {
         return file.filename;
    });
}

export function  CreateFiles(metadata: FileMetadata[]): string [] {
    let viewsFolder = path.resolve(__dirname, "view/");
    configure(viewsFolder, {autoescape: true, trimBlocks : true});

    let res: string [] = [];
    for ( var i = 0; i < metadata.length; i++ ) {
        var mdata = metadata[i];
        mdata.classes = mdata.classes.filter((item) => item.generateView);
        if(mdata.mapperPath) {
            mdata.classes.forEach(cl => {
                cl.viewModelFromMapper = require("path").relative(mdata.mapperPath, mdata.filename).split("\\").join("/").split(".ts").join("");
            });
        }
        var c = render("viewTemplateCommon.njk", {metafile: mdata});
        var mapperc = render("mapperTemplate.njk", {metafile: mdata});
        if (c && c.trim()) {
            var fs = require("fs");
            var mkdirp = require("mkdirp");
            var getDirName = require("path").dirname;
            mkdirp.sync(getDirName(mdata.filename));
            fs.writeFileSync(mdata.filename, c, "utf-8");
            res.push(c);

            let needMapper = true;
            mdata.classes.forEach(cls => {
                if (cls.needMapper === false) {
                    needMapper = false;
                }
            });
            if (needMapper) {
                let pathArray = mdata.filename.split(".ts").join("").split("/");
                let mapperfilename = mdata.mapperPath + "/" + pathArray[pathArray.length - 1] + "Mapper.ts";
                mkdirp.sync(mdata.mapperPath);
                fs.writeFileSync( mapperfilename, mapperc, "utf-8");
                res.push(mapperc);
            }
        }
    }

    return c;
}
function FillFileMetadataArray(generationFiles: FileMetadata[], genViewOpt: GenerateViewOptions, file: string) {
    let fileMet : FileMetadata;
    fileMet = new FileMetadata();
    fileMet.basePath = file;
    fileMet.classes = new Array<ClassMetadata>();
    fileMet.filename = genViewOpt.modelName;
    fileMet.mapperPath = genViewOpt.mapperPath;
    generationFiles.push( fileMet);
}
function ViewModelTypeCorrecting(input: string): string {
    let firstViewModelTypeInArray = input.split("@ViewModelType");
    let result = firstViewModelTypeInArray.map( str => {
        let tmpStr =  str.trim();
        let viewModelTypeDecoratorRegExp = /\(\s?{\s*?["']type["']\s?:\s?\w+/;
        let matches = viewModelTypeDecoratorRegExp.exec(tmpStr);
        if (matches) {
            let need = matches[0];
            let matchRegExp = /[A-Z]\w+/;
            let innerMatches = matchRegExp.exec(need);
            tmpStr = tmpStr.replace(innerMatches[0], `"${innerMatches[0]}"`);
        }
        let viewModelTypeDecoratorForTransformer = /["']function["']\s?:\s?\w+(\.)?(\w+)?/;
        let secMatches = viewModelTypeDecoratorForTransformer.exec(tmpStr);
        if (secMatches) {
            let need = secMatches[0];
            let matchRegExp = /:\s?\w+(\.)?(\w+)?/;
            let innerMatches = matchRegExp.exec(need);
            let variant = `: "${innerMatches[0].substring(1).trim()}"`;
            tmpStr =  tmpStr.replace(innerMatches[0], variant);
        }
        return tmpStr;
    }).join("@ViewModelType");
    return result;
}
function makeCorrectImports(fileMetadata: FileMetadata , imports: ImportNode[]) {
    fileMetadata.classes.forEach(cls => {
        let usingTypesInClass = cls.fields.filter(fld => {
            if (fld.ignoredInView) {
                return false;
            }
            return true;
        }).map(fld => {
            return fld.type;
        });
        let indexesOfCorrectImoprts = [];
        let imoprtsForMapper = [];
        usingTypesInClass = unique(usingTypesInClass);
        cls.fields.forEach(f => {
            if ( f.fieldConvertFunction && !f.ignoredInView) {
                usingTypesInClass.push(f.fieldConvertFunction.function.split(".")[0]);
                imoprtsForMapper .push(f.fieldConvertFunction.function.split(".")[0]);
            }
        });
        usingTypesInClass.forEach(type => {
            for ( let ind = 0; ind < imports.length; ind++) {
                if ( imports[ind].clauses.indexOf(type) > -1) {
                    indexesOfCorrectImoprts.push(ind);
                }
            }
        });
        indexesOfCorrectImoprts.forEach(ind => {
            let imp = new Import();
            imp.type = "{ " + imports[ind].clauses.join(",") + " }";
            let toPath = imports[ind].absPathNode.join("/");
            let fromPath = fileMetadata.filename.split(".ts").join("");
            let _path: string = toPath;
            if (!imports[ind].isNodeModule) {
                _path = path.relative(path.dirname(fromPath), toPath).split("\\").join("/");
                if ( _path.indexOf("./") < 0 ) {
                _path = "./" + _path;
                }
            }
            imp.path = _path;
            imoprtsForMapper.forEach( impForMapper => {
                if (imports[ind].clauses.indexOf(impForMapper) > -1) {
                    fromPath = fileMetadata.mapperPath.split(".ts").join("");
                    imp.path = path.relative(fromPath, toPath).split("\\").join("/");
                    imp.forMapper = true;
                }
            });
            fileMetadata.imports.push(imp);
        });
    });
}
function unique(arr: string[]): string[] {
    let obj = {};

    for (var i = 0; i < arr.length; i++) {
      var str = arr[i];
      obj[str] = true;
    }
    return Object.keys(obj);
}
function getAllfiles(path: string, resultPathes: string[], igoringFolders: string[]) {
    fs.readdirSync(path).forEach(f => {
        if (!(igoringFolders.map(folder => { return ".//"+folder }).indexOf(path+`/${f}`) > -1)) {
            if (fs.statSync(path + `/${f}`).isDirectory()) {
            getAllfiles(path + `/${f}` , resultPathes, igoringFolders);
            } else {
                let tsRegExp = /.+\.ts$/;
                let p = path + `/${f}`;
                let matches = tsRegExp.exec(p);
                if ( matches && matches.length > 0) {
                    resultPathes.push( matches[0]);
                }
            }
        }
    });
  }