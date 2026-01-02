package service

import (
	"context"
	"enx-data-service/internal/db"
	"enx-data-service/internal/model"
	pb "enx-data-service/proto"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type DataService struct {
	pb.UnimplementedDataServiceServer
	db *db.Database
}

func NewDataService(db *db.Database) *DataService {
	return &DataService{db: db}
}

func (s *DataService) GetWord(ctx context.Context, req *pb.GetWordRequest) (*pb.GetWordResponse, error) {
	word, err := s.db.GetWord(req.Id)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "word not found: %v", err)
	}
	return &pb.GetWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *DataService) CreateWord(ctx context.Context, req *pb.CreateWordRequest) (*pb.CreateWordResponse, error) {
	word := &model.Word{
		English: req.English,
	}
	if req.Chinese != "" {
		word.Chinese = &req.Chinese
	}
	if req.Pronunciation != "" {
		word.Pronunciation = &req.Pronunciation
	}

	if err := s.db.CreateWord(word); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create word: %v", err)
	}

	return &pb.CreateWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *DataService) UpdateWord(ctx context.Context, req *pb.UpdateWordRequest) (*pb.UpdateWordResponse, error) {
	word := convertProtoToModel(req.Word)
	if err := s.db.UpdateWord(word); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update word: %v", err)
	}
	return &pb.UpdateWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *DataService) DeleteWord(ctx context.Context, req *pb.DeleteWordRequest) (*pb.DeleteWordResponse, error) {
	if err := s.db.DeleteWord(req.Id); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete word: %v", err)
	}
	return &pb.DeleteWordResponse{Id: req.Id}, nil
}

func (s *DataService) ListWords(ctx context.Context, req *pb.ListWordsRequest) (*pb.ListWordsResponse, error) {
	limit := int(req.Limit)
	if limit == 0 {
		limit = 100 // Default limit
	}
	offset := int(req.Offset)

	words, total, err := s.db.ListWords(limit, offset)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list words: %v", err)
	}

	pbWords := make([]*pb.Word, len(words))
	for i, word := range words {
		pbWords[i] = convertModelToProto(word)
	}

	return &pb.ListWordsResponse{
		Words: pbWords,
		Total: int32(total),
	}, nil
}

func (s *DataService) SyncWords(req *pb.SyncWordsRequest, stream pb.DataService_SyncWordsServer) error {
	words, err := s.db.SyncWords(req.SinceTimestamp)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to fetch changes: %v", err)
	}

	for _, word := range words {
		if err := stream.Send(&pb.SyncWordsResponse{Word: convertModelToProto(word)}); err != nil {
			return err
		}
	}

	return nil
}

func convertProtoToModel(p *pb.Word) *model.Word {
	word := &model.Word{
		ID:        p.Id,
		English:   p.English,
		CreatedAt: p.CreatedAt,
		LoadCount: int(p.LoadCount),
		UpdatedAt: p.UpdatedAt,
	}

	if p.Chinese != "" {
		word.Chinese = &p.Chinese
	}
	if p.Pronunciation != "" {
		word.Pronunciation = &p.Pronunciation
	}
	if p.DeletedAt != 0 {
		word.DeletedAt = &p.DeletedAt
	}

	return word
}

// GetUserDict retrieves user dictionary entry
func (s *DataService) GetUserDict(ctx context.Context, req *pb.GetUserDictRequest) (*pb.GetUserDictResponse, error) {
	userDict, err := s.db.GetUserDict(req.UserId, req.WordId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "user dict not found: %v", err)
	}
	return &pb.GetUserDictResponse{UserDict: convertUserDictModelToProto(userDict)}, nil
}

// UpsertUserDict creates or updates user dictionary entry
func (s *DataService) UpsertUserDict(ctx context.Context, req *pb.UpsertUserDictRequest) (*pb.UpsertUserDictResponse, error) {
	userDict := convertUserDictProtoToModel(req.UserDict)
	if err := s.db.UpsertUserDict(userDict); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to upsert user dict: %v", err)
	}
	return &pb.UpsertUserDictResponse{UserDict: convertUserDictModelToProto(userDict)}, nil
}

func convertUserDictModelToProto(m *model.UserDict) *pb.UserDict {
	return &pb.UserDict{
		UserId:            m.UserId,
		WordId:            m.WordId,
		QueryCount:        int32(m.QueryCount),
		AlreadyAcquainted: int32(m.AlreadyAcquainted),
		CreatedAt:         m.CreatedAt,
		UpdatedAt:         m.UpdatedAt,
	}
}

func convertUserDictProtoToModel(p *pb.UserDict) *model.UserDict {
	return &model.UserDict{
		UserId:            p.UserId,
		WordId:            p.WordId,
		QueryCount:        int(p.QueryCount),
		AlreadyAcquainted: int(p.AlreadyAcquainted),
		CreatedAt:         p.CreatedAt,
		UpdatedAt:         p.UpdatedAt,
	}
}
