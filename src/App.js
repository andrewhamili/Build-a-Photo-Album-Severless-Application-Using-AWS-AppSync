import React from 'react';
import aws_exports from './aws-exports';
import { withAuthenticator, Connect, S3Image } from 'aws-amplify-react';
import Amplify, { API, graphqlOperation, Storage, I18n } from 'aws-amplify';
import { Divider, Form, Grid, Header, Input, List, Segment } from 'semantic-ui-react';
import {BrowserRouter as Router, Route, NavLink, Redirect} from 'react-router-dom';
import {v4 as uuid} from 'uuid';

Amplify.configure(aws_exports);
I18n.setLanguage('en');

const wrapperStyle = {
  'position': 'fixed',
  'width': `100%`,
  'height': `100%`,
  'top': 0,
  'left': 0,
  'right': 0,
  'bottom': 0,
  'margin': 'auto',
  'background-color': `rgba(0,0,0, 0.5)`
};

const ListAlbums = `query ListAlbums {
  listAlbums(limit: 9999) {
    items {
        id
        name
        owner
    }
  }
}`;

const SubscribeToNewAlbums = `
  subscription OnCreateAlbum {
    onCreateAlbum {
      id
      name
      owner
    }
  }
`;

const GetAlbum = `query GetAlbum($id: ID!, $nextTokenForPhotos: String) {
  getAlbum(id: $id) {
    id
    name
    photos(sortDirection: DESC, limit: 999, nextToken: $nextTokenForPhotos) {
      nextToken
      items {
        fullsize {
          width
          height
          key
        }
        thumbnail {
          width
          height
          key
        }
      }
    }
  }
}
`;

function sleep(ms) {
  var start= new Date().getTime();
  while( (new Date().getTime() - start) < ms) {} 
}

function makeComparator(key, order = 'asc') {
  return (a, b) => {
    if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) return 0;

    const aVal = (typeof a[key] === 'string') ? a[key].toUpperCase() : a[key];
    const bVal = (typeof b[key] === 'string') ? b[key].toUpperCase() : b[key];

    let comparison = 0;
    if (aVal > bVal) comparison = 1;
    if (aVal < bVal) comparison = -1;

    return order === 'desc' ? (comparison * -1) : comparison
  };
}

class AlbumsListLoader extends React.Component {
  constructor(props) {
    super(props);
    this.state = { existNewAlbum: this.props.existNewAlbum };
  }

  onNewAlbum = (prevQuery, newData) => {
    let updatedQuery = Object.assign({}, prevQuery);
    updatedQuery.listAlbums.items = prevQuery.listAlbums.items.concat([newData.onCreateAlbum]);
    return updatedQuery;
  }

  render() {
    return (
      <Connect
        query={graphqlOperation(ListAlbums) } 
        subscription={graphqlOperation(SubscribeToNewAlbums)}
        onSubscriptionMsg={this.onNewAlbum}
      >
        {({ data, loading, errors }) => {
          if (loading) { return <div>Loading...</div>; }
          if (!data.listAlbums) { return <div>Oops, you don't have any album yet.</div>; }

          return <AlbumsList albums={data.listAlbums.items} username={this.props.username} />;
        }}
      </Connect>
    );
  }
}


class AlbumsList extends React.Component {

  albumItems() {
    var validAlbums = [];
    /* Filter out albums which its "owner" is not equal to username */
    this.props.albums.sort(makeComparator('name')).forEach(album => {
      if (album.owner === this.props.username && !validAlbums.includes(album))
        validAlbums.push(album);
    });
    return validAlbums.sort(makeComparator('name')).map(album =>
      <List.Item key={album.id}>
        <NavLink to={`/albums/${album.id}`}>{album.name}</NavLink>
      </List.Item>
    );
  }

  render() {
    return (
      <Segment>
        <Header as='h3'>My Albums</Header>
        <List divided relaxed>
          {this.albumItems()}
        </List>
      </Segment>
    );
  }
}


class NewAlbum extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      albumName: '',
    };
  }


  handleChange = (e, { name, value }) => this.setState({ [name]: value })

  handleSubmit = async (event) => {
    event.preventDefault();
    
    try {
      const NewAlbum = `mutation NewAlbum($name: String!, $owner: String!) {
        createAlbum(input: {name: $name, owner: $owner}) {
            id
            name
            owner
        }
      }`;
      const result = await API.graphql(graphqlOperation(NewAlbum, { name: this.state.albumName, owner: this.props.username }));
      console.info(`Created album with id ${result.data.createAlbum.id}`);
      this.setState({ albumName: ''});
    }
    catch (err) {
      console.error('NewAlbum mutation failed', err);
    }
  }

  render() {
    return (
      <Segment>
        <Header as='h3'>Add a new album</Header>
        <Input
          type='text'
          placeholder='New Album Name'
          icon='plus'
          iconPosition='left'
          action={{ content: 'Create', onClick: this.handleSubmit }}
          name='albumName'
          value={this.state.albumName}
          onChange={this.handleChange}
        />
      </Segment>
    )
  }
}


class AlbumDetailsLoader extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      nextTokenForPhotos: null,
      hasMorePhotos: true,
      album: null,
      loading: true
    }
  }
  
  updateS3UploadParent() {
    this.setState({ hasMorePhotos: true });
    this.loadMorePhotos();
  }

  
  updatePhotoListParent() {
    this.forceUpdate();
  }

  async loadMorePhotos() {
    if (this.state.hasMorePhotos) {
      this.setState({ loading: true });
      const { data } = await API.graphql(graphqlOperation(GetAlbum, {id: this.props.id, nextTokenForPhotos: this.state.nextTokenForPhotos}));
      let album = data.getAlbum;

      this.setState({ 
        album: album,
        loading: false,
        nextTokenForPhotos: album.photos.nextToken,
        hasMorePhotos: album.photos.nextToken !== null
      });
    }
  }

  componentDidMount() {
    this.loadMorePhotos();
  }

  render() {
    if (!this.state.album) return 'Loading album...';

    return (
      <Segment>
        <Header as='h3'>{this.state.album.name}</Header>
        <S3ImageUpload albumId={this.state.album.id} updateParent={this.updateS3UploadParent.bind(this)} />
        <PhotosList photos={this.state.album.photos.items} updateParent={this.updatePhotoListParent.bind(this)} />
        { // if hasMorePhotos and notLoading, show button.
          this.state.hasMorePhotos && !this.state.loading && 
          <Form.Button
            onClick={this.loadMorePhotos.bind(this)}
            icon='refresh'
            disabled={this.state.loading}
            content={'Load more photos'}
          />
        }
        { this.state.loading && 'Loading...' }
      </Segment>
    )
  }
}

class S3ImageUpload extends React.Component {
  constructor(props) {
    super(props);
    this.state = { uploading: false }
  }

  onChange = async (e) => {
    const files = e.target.files;

    if (files.length > 0) {
      this.setState({uploading: true});

      for (var i = 0 ; i < files.length ; i++) {
        let file = files[i];
        
        if (file.type.startsWith("image/")) {
          const fileName = uuid();
          const result = await Storage.put(
            fileName, 
            file, 
            {
              customPrefix: { public: 'uploads/' },
              metadata: { albumid: this.props.albumId }
            }
          );
          console.log('Uploaded file: ', result);
        }
      } // for
      sleep(3000);
      this.setState({uploading: false});
      this.props.updateParent();
    } // if
  }

  render() {
    return (
      <div>
        <Form.Button
              onClick={() => document.getElementById('add-image-file-input').click()}
              disabled={this.state.uploading}
              icon='file image outline'
              content={ this.state.uploading ? 'Uploading...' : 'Add Image' }
        />
        <input
          id='add-image-file-input'
          type="file"
          accept='image/*'
          onChange={this.onChange}
          multiple
          style={{ display: 'none' }}
          
        />
      </div>
    );
  }
}


class PhotosList extends React.Component {
  constructor(props) {
    super(props);
    this.state = { showPopImage: false, imgKey: '' };
  }

  render() {

    const PopImage = (
      <div style={wrapperStyle} onClick={ () => this.setState({ showPopImage: false }) }>
        <S3Image
          key={this.state.key}
          imgKey={this.state.imgKey}
          onClick={ () => this.setState({ showPopImage: false }) }
        />
      </div>
    )

    return (
      <div>
        <Divider hidden/>
        {this.props.photos.map(photo =>
          <S3Image
            key={photo.thumbnail.key} 
            imgKey={photo.thumbnail.key.replace('public/', '')}
            style={{
              'display': 'inline-block',
              'paddingRight': '5px',
            }}
            updateParent={this.props.updateParent.bind(this)}
            onClick={ () => {
              this.setState({
                showPopImage: true,
                key: photo.fullsize.key,
                imgKey: photo.fullsize.key.replace('public/', '') 
              });
              this.props.updateParent(); 
            }}
          />
        )}
        {this.state.showPopImage ? PopImage : ''}
      </div>
    );
  }
}

class App extends React.Component {
  render() {
    const centerLogo = {"height": 40, "display": "block", "margin": "auto"};
    return (
      <Router>
        <Grid padded>
          <Grid.Column>
            
            <Redirect to="/" />
            <Route
              path="/"
              exact render={ () => <NewAlbum  username={this.props.authData.username} /> }
            />
            <Route path="/" 
              exact render={ () => <AlbumsListLoader username={this.props.authData.username} /> } 
            />
            <Route
              path="/"
              exact render={ () => <img src={ require('./ecloudture.png') } alt="" style={centerLogo} /> }
            />
          
            <Route
              path="/albums/:albumId"
              render={ () => <div><NavLink to='/'>Back to Albums list</NavLink></div> }
            />
            <Route
              path="/albums/:albumId"
              render={ props => <AlbumDetailsLoader id={props.match.params.albumId}/> }
            />
            <Route
              path="/albums/:albumId"
              exact render={ () => <img src={ require('./ecloudture.png') } alt="" style={centerLogo} /> }
            />
            
          </Grid.Column>
        </Grid>
      </Router>
    );
  }
}

export default withAuthenticator(App, { includeGreetings: true });