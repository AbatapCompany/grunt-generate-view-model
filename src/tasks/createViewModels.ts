import * as fs from "fs";
import * as path from "path";
import {parseStruct, ImportNode} from "ts-file-parser";
import {render, configure} from "nunjucks";

import { Import } from "./model/import";
import { Config } from "./model/config";
import {FileMetadata} from "./model/filemetadata";
import {ClassMetadata} from "./model/classmetadata";
import { GenerateViewOptions } from "./model/generateViewOptions";
import { Transformer } from "./model/transformer";

import { downFirstLetter, unique } from "./pipes";
import { Decorators } from "./pipes/decorators";
import { asyncDirection, ConsoleColor, FuncDirection } from "./pipes/enums";
import { createClassMeta, createFieldMetadata, filterFileMetadata, getDependencyImportsForImports, mapFileClasses, } from "./pipes/classmeta";
import { FieldMetadata } from "./model/fieldmetadata";
import { createMapperFile, getAllFiles } from "./pipes/files";

const mkdirp = require("mkdirp");
const primitiveTypes = ["string", "number", "object", "any" , "null", "undefined"];

const configName = "genconfig.json";

const UTF8 = "utf8";

export function createMetadatas(files: string[]): FileMetadata[] {
    let generationFiles: FileMetadata[] = [];
    console.log(ConsoleColor.Cyan, `GenerateView: Create Metadata for files...`);
    for (let file of files) {
        console.log(ConsoleColor.Cyan, `GenerateView: Create Metadata for ${file}...`);
        const stringFile = fs.readFileSync(file, "utf-8");
        const jsonStructure = parseStruct(stringFile, {}, file);
        let possibleImports = jsonStructure._imports || [];

        jsonStructure.classes.forEach(cls => {
            const generateViewDecorators = (cls.decorators || []).filter(dec => dec.name === Decorators.GenerateView);

            if (!generateViewDecorators.length) {
                return;
            }

            const classesMeta = generateViewDecorators.map(dec => {
                let genViewOpt = dec.arguments[0].valueOf() as GenerateViewOptions;
                const classMeta = createClassMeta(genViewOpt.model);
                FillFileMetadataArray(generationFiles, genViewOpt, file);
                return classMeta;
            });

            classesMeta.forEach(cm => {
                cm.baseName = cls.name;
                cm.baseNamePath =  file;
                cls.fields.forEach(fld => {
                    const fieldMetadata = createFieldMetadata(fld, jsonStructure, cm, possibleImports);
                    cm.fields.push(fieldMetadata);
                });

                const fieldsWithConvertFunctions = cm.fields.filter(f => f.fieldConvertFunction);

                fieldsWithConvertFunctions.forEach(f => {
                    let func = f.fieldConvertFunction;
                    saveInfoAboutTransformer(FuncDirection.toView, func, possibleImports, cm);
                    saveInfoAboutTransformer(FuncDirection.fromView, func, possibleImports, cm);
                });
            });

            generationFiles.forEach(genFile => {
                classesMeta.forEach( cm => {
                    const classMetaFileName = `${downFirstLetter(cm.name)}.ts`;
                    if (genFile.filename.indexOf(classMetaFileName) === -1) {
                        return;
                    }
                    genFile.classes.push(cm);
                });
                makeCorrectImports(genFile, possibleImports);
            });
        });
        console.log(ConsoleColor.Cyan, `GenerateView: Create Metadata for ${file} end`);
        console.log(ConsoleColor.Cyan, `---`);
    }
    console.log(ConsoleColor.Cyan, `GenerateView: Create Metadata for files end`);
    return generationFiles.filter(file => file.filename);
}

export function createFiles(filesMetadata: FileMetadata[]): void {
    console.log(ConsoleColor.Cyan, `GenerateView: Create Files`);
    const viewsFolder = path.resolve(__dirname, "view/");
    configure(viewsFolder, {autoescape: true, trimBlocks : true});
    filesMetadata.forEach(_fileMetadata => {
        console.log(ConsoleColor.Cyan, `GenerateView: creating file "${_fileMetadata.filename}"`);

        const fileMetadata = {..._fileMetadata};
        fileMetadata.classes = fileMetadata.classes.filter(item => item.generateView);
        if (fileMetadata.mapperPath) {
            fileMetadata.classes = mapFileClasses(fileMetadata.classes, fileMetadata);
        }
        fileMetadata.imports = filterFileMetadata(fileMetadata.imports, fileMetadata.classes);

        const generatedClassFileContent = render("viewTemplateCommon.njk", {metafile: fileMetadata});
        let createdMapperFileContent = render("mapperTemplate.njk", {metafile: fileMetadata});
        const generatedFileExist = generatedClassFileContent && generatedClassFileContent.trim();

        if (!generatedFileExist) {
            return;
        }

        mkdirp.sync(path.dirname(fileMetadata.filename));
        fs.writeFileSync(fileMetadata.filename, generatedClassFileContent, "utf-8");

        let needMapper = !fileMetadata.classes.some(cls => !cls.needMapper);

        console.log(ConsoleColor.Cyan, `GenerateView: file "${_fileMetadata.filename}" created`);

        if (!needMapper) {
            console.log(ConsoleColor.Cyan, `---`);
            return;
        }

        createMapperFile(fileMetadata, createdMapperFileContent);
        console.log(ConsoleColor.Cyan, `GenerateView: mapper file "${_fileMetadata.filename}" created`);
        console.log(ConsoleColor.Cyan, `---`);
    });
    console.log(ConsoleColor.Cyan, `GenerateView: Create Files end`);
}

function saveInfoAboutTransformer(direction: FuncDirection, func: Transformer, possibleImports: ImportNode[], cm: ClassMetadata) {
    if (!direction) {
        return;
    }
    const isTransformFunctionExist = func[direction] && func[direction].function;
    if (!isTransformFunctionExist) {
        return;
    }
    const importFunctionName = func[direction].function;
    const moduleImport = possibleImports.find(possibleImport => possibleImport.clauses.indexOf(importFunctionName) > -1);
    if (moduleImport) {
        let stringFile = "";
        let pathFromFile = moduleImport.absPathNode.join("/");
        const getContentFrom = (from: string) => {
            stringFile = fs.readFileSync(path.resolve(pathFromFile + from)).toString();
            pathFromFile = `${pathFromFile}${from}`;
        };

        try {
            getContentFrom(".ts");
        } catch (e) {
            getContentFrom("/index.ts");
        }

        const jsonStructure = parseStruct(stringFile, {}, pathFromFile);
        const { functions } = jsonStructure;

        const targetFuncs = functions.find(func => func.name === importFunctionName);
        func[direction].isAsync = targetFuncs.isAsync;
        const asyncDirect = asyncDirection[direction];
        if (!cm[asyncDirect]) {
            cm[asyncDirect] = targetFuncs.isAsync;
        }
        func[direction].isPrimitive = false;
        const contextTypeOfTransformer = targetFuncs.params[1] && targetFuncs.params[1].type || null;
        const contextMandatoryOfType = targetFuncs.params[1] && targetFuncs.params[1].mandatory || false;
        const directionValueInfo = cm.contextType[direction];
        if (!contextTypeOfTransformer) {
            return;
        }
        if (!directionValueInfo.value || directionValueInfo.value === contextTypeOfTransformer || contextTypeOfTransformer === "any") {
            directionValueInfo.value = contextTypeOfTransformer;
            directionValueInfo.mandatory = contextMandatoryOfType || directionValueInfo.mandatory;
            const fieldsWithContext =  cm.fields.filter(f => f.fieldConvertFunction && f.fieldConvertFunction[direction]);
            fieldsWithContext.forEach(f => {
                const funcToRecognize =  functions.find(func => func.name === f.fieldConvertFunction[direction].function);
                const isFuncsWithParams = funcToRecognize && funcToRecognize.params && funcToRecognize.params[1];
                if (!isFuncsWithParams) {
                    return;
                }
                cm.contextTypeFields[direction].push(f.name);
            });
        } else {
            throw new Error("Context for one-side mapper should be of one type or any");
        }
        const isPrimitiveType = !!primitiveTypes.find(type => type === directionValueInfo.value );
        if (isPrimitiveType) {
            return;
        }
        const contextTypeImport = jsonStructure._imports.find(imp => !!imp.clauses.find(clause =>  directionValueInfo.value === clause));
        possibleImports.push({
            clauses: [directionValueInfo.value],
            absPathNode: contextTypeImport.absPathNode,
            isNodeModule: false
        });
        return;
    }
    func[direction].isPrimitive = true;
    if ( func[direction].function !== "null" && func[direction].function !== "undefined") {
        func[direction].isPrimitiveString = isNaN(+func[direction].function);
    } else {
        func[direction].isPrimitiveString = false;
    }
}


function FillFileMetadataArray(generationFiles: FileMetadata[], genViewOpt: GenerateViewOptions, file: string) {
    const {filePath, model} = genViewOpt;
    const fileMet = new FileMetadata();
    fileMet.basePath = file;
    fileMet.classes = [];
    fileMet.filename = `${filePath}/${downFirstLetter(model)}.ts`;
    fileMet.mapperPath = genViewOpt.mapperPath;
    generationFiles.push(fileMet);
    return fileMet ;
}

const getInfoFromClassField = (classField: FieldMetadata) => {

    const usingTypesInClass: string[] = [];
    const importsForMapper: string[] = [];
    if ( classField.fieldConvertFunction && !classField.ignoredInView) {
        [FuncDirection.toView, FuncDirection.fromView].forEach(direction => {
            const directionInfo = classField.fieldConvertFunction[direction];
            const isDirectionTypeIsPrimitive = directionInfo && directionInfo.isPrimitive;
            if (!isDirectionTypeIsPrimitive) {
                return;
            }
            let mainClass = directionInfo.function.split(".")[0];
            usingTypesInClass.push(mainClass);
            importsForMapper.push(mainClass);
        });
    }
    if (classField.needGeneratedMapper) {
        usingTypesInClass.push(`${classField.type}Mapper`);
        importsForMapper.push(`${classField.type}Mapper`);
    }
    return {
        usingTypesInClass,
        importsForMapper
    };
};



function makeCorrectImports(fileMetadata: FileMetadata , imports: ImportNode[]) {
    fileMetadata.classes.forEach(cls => {
        let usingTypesInClass = unique(cls.fields
            .filter(fld => !fld.ignoredInView)
            .map(fld => fld.type));
        let indexesOfCorrectImports: number[] = [];
        let importsForMapper: string[] = [];
        cls.fields.map(getInfoFromClassField).forEach(info => {
            usingTypesInClass.push(...info.usingTypesInClass);
            importsForMapper.push(...info.importsForMapper);
        });
        if (cls.contextType.fromView && !primitiveTypes.find(type => cls.contextType.fromView.value === type)) {
            importsForMapper.push(cls.contextType.fromView.value);
            indexesOfCorrectImports = imports.map((_import, index) => {
                const clause = _import.clauses.find( clause => clause === cls.contextType.fromView.value);
                return clause ? index : null;
            }).filter(i => !!i);
        }
        if (cls.contextType.toView && !primitiveTypes.find(type => cls.contextType.toView.value === type)) {
            importsForMapper.push(cls.contextType.toView.value);
            imports.forEach((ind, j) => {
                const clause = ind.clauses.find( clause => clause === cls.contextType.toView.value);
                if (!clause) {
                    return;
                }
                indexesOfCorrectImports.push(j);
            });
        }
        usingTypesInClass.forEach(type => {
            imports.forEach((currentImport, ind) => {
                const indexOfImportClauses = currentImport.clauses.indexOf(type);
                if (indexOfImportClauses === -1) {
                    return;
                }
                indexesOfCorrectImports.push(ind);
            });
        });
        const uniqueIndexesOfCorrectImports = new Set(indexesOfCorrectImports);
        uniqueIndexesOfCorrectImports.forEach(ind => {
            let imp = new Import();
            imp.type = `{ ${imports[ind].clauses.join(",")} }`;
            let toPath = imports[ind].absPathNode.join("/");
            let fromPath = fileMetadata.filename.split(".ts").join("");
            let _path: string = toPath;
            if (!imports[ind].isNodeModule) {
                const from = path.dirname(fromPath);
                _path = path.relative(from, toPath).split("\\").join("/");
                if ( _path.indexOf("./") < 0 ) {
                    _path =  `./${_path}`;
                }
            }
            imp.path = _path;
            importsForMapper.forEach( impForMapper => {
                const indexOFImportClauses = imports[ind].clauses.indexOf(impForMapper);
                if (indexOFImportClauses === -1) {
                    return;
                }
                fromPath = fileMetadata.mapperPath;
                let arrayPath = path.relative(fromPath, toPath).split("\\");
                const arrayPathLength = arrayPath.length - 1;
                arrayPath[arrayPathLength] = downFirstLetter(arrayPath[arrayPathLength]);
                imp.path = arrayPath.join("/");
                if ( imp.path.indexOf("./") < 0 && !imports[ind].isNodeModule ) {
                    imp.path = `./${imp.path}`;
                }
                imp.forMapper = true;
            });

            fileMetadata.imports.push(imp);
        });
    });
    let tmpImports : Import[] = [];
    fileMetadata.imports.forEach( i => {
        const isExist = !!tmpImports.find(ti => ti.type === i.type);
        if (!isExist) {
            tmpImports.push(i);
        }
    });
    fileMetadata.imports = tmpImports;
    fileMetadata.imports = FilterImportingMappers(fileMetadata);
    fileMetadata.imports = filterTransformerWhichAlreadyExistInMapper(fileMetadata.imports);
}

function FilterImportingMappers(meta: FileMetadata) {
    let {imports} = meta;
    imports = getDependencyImportsForImports(imports, meta);
    return imports;
}

function filterTransformerWhichAlreadyExistInMapper(imports: Import[]) {
    const tmpImports = imports;
    const newImports: Import[] = [];
    tmpImports.forEach(imp => {
        if (newImports.length === 0) {
            newImports.push(imp);
            return;
        }
        const newImportsSamePathImports = newImports.find(_import => _import.path === imp.path);
        if (!newImportsSamePathImports) {
            newImports.push(imp);
            return;
        }
        const targetImportClauses = imp.type.replace("{", "").replace("}", "").trim().split(",");
        const commonArrayOfClauses = Array.from(new Set([...targetImportClauses]));
        newImportsSamePathImports.type = `{ ${commonArrayOfClauses.join(",")} }`;
    });
    return newImports;
}


export function createViewModelsInternal(): void {
    const dateStart = Date.now();
    let config: Config = JSON.parse(fs.readFileSync(configName, UTF8));
    const possibleFiles = getAllFiles(config.check.folders);
    const metadata = createMetadatas(possibleFiles);
    createFiles(metadata);
    const dateEnd = Date.now();

    console.log(ConsoleColor.Green, `Generate View: Count of files: ${possibleFiles.length}`);
    console.log(`Generate View: Execution time: ${dateEnd - dateStart}ms`);
    console.log(ConsoleColor.Default);
}
