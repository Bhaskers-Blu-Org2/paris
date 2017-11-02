"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var entity_config_1 = require("../entity/entity.config");
var Observable_1 = require("rxjs/Observable");
var Subject_1 = require("rxjs/Subject");
var data_transformers_service_1 = require("../services/data-transformers.service");
var cache_1 = require("../services/cache");
var value_objects_service_1 = require("../services/value-objects.service");
var _ = require("lodash");
var data_options_1 = require("../dataset/data.options");
var Repository = /** @class */ (function () {
    function Repository(entity, config, entityConstructor, dataStore, paris) {
        this.entity = entity;
        this.config = config;
        this.entityConstructor = entityConstructor;
        this.dataStore = dataStore;
        this.paris = paris;
        var getAllItems$ = this.getItemsDataSet().map(function (dataSet) { return dataSet.items; });
        this._allItemsSubject$ = new Subject_1.Subject();
        this._allItems$ = Observable_1.Observable.merge(getAllItems$, this._allItemsSubject$.asObservable());
        this._saveSubject$ = new Subject_1.Subject();
        this.save$ = this._saveSubject$.asObservable();
    }
    Object.defineProperty(Repository.prototype, "allItems$", {
        get: function () {
            if (this._allValues)
                return Observable_1.Observable.merge(Observable_1.Observable.of(this._allValues), this._allItemsSubject$.asObservable());
            if (this.entity.loadAll)
                return this.setAllItems();
            return this._allItems$;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Repository.prototype, "cache", {
        get: function () {
            var _this = this;
            if (!this._cache) {
                var cacheSettings = Object.assign({
                    getter: function (itemId) { return _this.getItemById(itemId, { allowCache: false }); }
                }, this.entity.cache);
                this._cache = new cache_1.DataCache(cacheSettings);
            }
            return this._cache;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Repository.prototype, "baseUrl", {
        get: function () {
            if (!this.entity.baseUrl)
                return null;
            return this.entity.baseUrl instanceof Function ? this.entity.baseUrl(this.config) : this.entity.baseUrl;
        },
        enumerable: true,
        configurable: true
    });
    Repository.prototype.createItem = function (itemData, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        return Repository.getModelData(itemData, this.entity, this.config, this.paris);
    };
    Repository.prototype.createNewItem = function () {
        return new this.entityConstructor();
    };
    /**
     * Populates the item dataset with any sub @model. For example, if an ID is found for a property whose type is an entity,
     * the property's value will be an instance of that entity, for the ID, not the ID.
     * @param {Index} itemData
     * @param {EntityConfigBase} entity
     * @param {ParisConfig} config
     * @param {Paris} paris
     * @param {DataOptions} options
     * @returns {Observable<T extends EntityModelBase>}
     */
    Repository.getModelData = function (itemData, entity, config, paris, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        var entityIdProperty = entity.idProperty || config.entityIdProperty, modelData = entity instanceof entity_config_1.ModelEntity ? { id: itemData[entityIdProperty] } : {}, subModels = [];
        entity.fields.forEach(function (entityField) {
            var propertyValue = entityField.data ? _.get(itemData, entityField.data) : itemData[entityField.id];
            if (propertyValue === undefined || propertyValue === null) {
                modelData[entityField.id] = entityField.isArray ? [] : entityField.defaultValue || null;
            }
            else {
                var propertyRepository_1 = paris.getRepository(entityField.type);
                if (propertyRepository_1) {
                    var getPropertyEntityValue$ = void 0;
                    var mapValueToEntityFieldIndex = Repository.mapToEntityFieldIndex.bind(null, entityField.id);
                    if (entityField.isArray) {
                        var propertyMembers$ = propertyValue.map(function (memberData) { return Repository.getEntityItem(propertyRepository_1, memberData, options); });
                        getPropertyEntityValue$ = Observable_1.Observable.combineLatest.apply(Observable_1.Observable, propertyMembers$).map(mapValueToEntityFieldIndex);
                    }
                    else
                        getPropertyEntityValue$ = Repository.getEntityItem(propertyRepository_1, propertyValue, options).map(mapValueToEntityFieldIndex);
                    subModels.push(getPropertyEntityValue$);
                }
                else {
                    var valueObjectType_1 = value_objects_service_1.valueObjectsService.getEntityByType(entityField.type);
                    if (valueObjectType_1) {
                        var getPropertyEntityValue$ = void 0;
                        var mapValueToEntityFieldIndex = Repository.mapToEntityFieldIndex.bind(null, entityField.id);
                        if (entityField.isArray) {
                            if (propertyValue.length) {
                                var propertyMembers$ = propertyValue.map(function (memberData) { return Repository.getValueObjectItem(valueObjectType_1, memberData, paris, config, options); });
                                getPropertyEntityValue$ = Observable_1.Observable.combineLatest.apply(Observable_1.Observable, propertyMembers$).map(mapValueToEntityFieldIndex);
                            }
                            else
                                getPropertyEntityValue$ = Observable_1.Observable.of([]).map(mapValueToEntityFieldIndex);
                        }
                        else {
                            getPropertyEntityValue$ = Repository.getValueObjectItem(valueObjectType_1, propertyValue, paris, config, options).map(mapValueToEntityFieldIndex);
                        }
                        subModels.push(getPropertyEntityValue$);
                    }
                    else {
                        modelData[entityField.id] = entityField.isArray
                            ? propertyValue
                                ? propertyValue.map(function (elementValue) { return data_transformers_service_1.DataTransformersService.parse(entityField.type, elementValue); })
                                : []
                            : data_transformers_service_1.DataTransformersService.parse(entityField.type, propertyValue);
                    }
                }
            }
        });
        if (subModels.length) {
            return Observable_1.Observable.combineLatest.apply(Observable_1.Observable, subModels).map(function (propertyEntityValues) {
                propertyEntityValues.forEach(function (propertyEntityValue) { return Object.assign(modelData, propertyEntityValue); });
                var model;
                try {
                    model = new entity.entityConstructor(modelData);
                }
                catch (e) {
                    console.error("Couldn't create " + entity.singularName + ".", e);
                }
                propertyEntityValues.forEach(function (modelPropertyValue) {
                    for (var p in modelPropertyValue) {
                        var modelValue = modelPropertyValue[p];
                        if (modelValue instanceof Array)
                            modelValue.forEach(function (modelValueItem) {
                                if (!Object.isFrozen(modelValueItem))
                                    modelValueItem.$parent = model;
                            });
                        else if (!Object.isFrozen(modelValue))
                            modelValue.$parent = model;
                    }
                });
                if (entity.readonly)
                    Object.freeze(model);
                return model;
            });
        }
        else {
            var model = void 0;
            try {
                model = new entity.entityConstructor(modelData);
            }
            catch (e) {
                console.error("Couldn't create " + entity.singularName + ".", e);
            }
            if (entity.readonly)
                Object.freeze(model);
            return Observable_1.Observable.of(model);
        }
    };
    Repository.mapToEntityFieldIndex = function (entityFieldId, value) {
        var data = {};
        data[entityFieldId] = value;
        return data;
    };
    Repository.getEntityItem = function (repository, itemData, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        return Object(itemData) === itemData ? repository.createItem(itemData, options) : repository.getItemById(itemData, options);
    };
    Repository.getValueObjectItem = function (valueObjectType, data, paris, config, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        // If the value object is one of a list of values, just set it to the model
        if (valueObjectType.hasValue(data))
            return Observable_1.Observable.of(valueObjectType.getValueById(data));
        return Repository.getModelData(data, valueObjectType, config, paris, options);
    };
    Repository.prototype.getItemsDataSet = function (options, dataOptions) {
        var _this = this;
        if (dataOptions === void 0) { dataOptions = data_options_1.defaultDataOptions; }
        return this.dataStore.get(this.entity.endpoint + "/" + (this.entity.allItemsEndpoint || ''), options, this.baseUrl)
            .map(function (rawDataSet) {
            var allItemsProperty = _this.entity.allItemsProperty || _this.config.allItemsProperty;
            var rawItems = rawDataSet instanceof Array ? rawDataSet : rawDataSet[allItemsProperty];
            if (!rawItems)
                console.warn("Property '" + _this.config.allItemsProperty + "' wasn't found in DataSet for Entity '" + _this.entity.pluralName + "'.");
            return {
                count: rawDataSet.count,
                items: rawItems
            };
        })
            .flatMap(function (dataSet) {
            var itemCreators = dataSet.items.map(function (itemData) { return _this.createItem(itemData, dataOptions); });
            return Observable_1.Observable.combineLatest.apply(_this, itemCreators).map(function (items) {
                return Object.freeze({
                    count: dataSet.count,
                    items: items
                });
            });
        });
    };
    Repository.prototype.getItemById = function (itemId, options) {
        var _this = this;
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        if (this.entity.values) {
            var entityValue = this.entity.getValueById(itemId);
            if (entityValue)
                return Observable_1.Observable.of(entityValue);
        }
        if (options.allowCache !== false && this.entity.cache)
            return this.cache.get(itemId);
        if (this.entity.loadAll)
            return this.setAllItems().map(function () { return _this._allValuesMap.get(String(itemId)); });
        else {
            return this.dataStore.get(this.entity.endpoint + "/" + itemId)
                .flatMap(function (data) { return _this.createItem(data, options); });
        }
    };
    Repository.prototype.setAllItems = function () {
        var _this = this;
        if (this._allValues)
            return Observable_1.Observable.of(this._allValues);
        return this.getItemsDataSet().do(function (dataSet) {
            _this._allValues = dataSet.items;
            _this._allValuesMap = new Map();
            _this._allValues.forEach(function (value) { return _this._allValuesMap.set(String(value.id), value); });
        }).map(function (dataSet) { return dataSet.items; });
    };
    // save(item: T): Observable<T> {
    // 	let saveData: Index = this.getItemSaveData(item);
    //
    // 	return this.dataStore.post(`${this.entity.endpoint}/${item.id || ''}`, saveData)
    // 		.flatMap((savedItemData: Index) => this.createItem(savedItemData))
    // 		.do((item: T) => {
    // 			if (this._allValues) {
    // 				this._allValues = [...this._allValues, item];
    // 				this._allItemsSubject$.next(this._allValues);
    // 			}
    //
    // 			this._saveSubject$.next(item);
    // 		});
    // }
    Repository.prototype.getItemSaveData = function (item) {
        var modelData = {};
        for (var propertyId in item) {
            if (item.hasOwnProperty(propertyId)) {
                var modelValue = void 0;
                var propertyValue = item[propertyId], entityField = this.entity.fields.get(propertyId);
                if (entityField) {
                    var propertyRepository = this.paris.getRepository(entityField.type);
                    if (propertyRepository)
                        modelValue = propertyValue.id;
                    else
                        modelValue = data_transformers_service_1.DataTransformersService.serialize(entityField.type, propertyValue);
                    modelData[entityField.id] = modelValue;
                }
            }
        }
        return modelData;
    };
    return Repository;
}());
exports.Repository = Repository;
